// POST pay-callback-idram — Idram EDP RESULT_URL (precheck + payment result).
// Answers text/plain "OK" when accepted; anything else refuses.
// See _shared/idram.ts for the protocol and the go-live checklist.

import { getConfig } from "../_shared/env.ts";
import { textResponse } from "../_shared/http.ts";
import {
  classifyIdramRequest,
  idramOrderProblem,
  parseFormBody,
  verifyIdramChecksum,
} from "../_shared/idram.ts";
import { parseWholeAmd } from "../_shared/money.ts";
import { confirmPayment, findOrderByProviderNum, logPaymentEvent, PAYABLE_STATUSES } from "../_shared/db.ts";
import { sanitizePayload, saltedHasher } from "../_shared/sanitize.ts";

const cfg = getConfig();
const PROVIDER = "idram";
const OK = "OK";
const REFUSE = "FAIL";

async function readFields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const out: Record<string, string> = {};
    for (const [k, v] of await req.formData()) if (typeof v === "string") out[k] = v;
    return out;
  }
  return parseFormBody(await req.text());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    const fields = await readFields(req);
    const kind = classifyIdramRequest(fields);
    const billNo = Number(fields.EDP_BILL_NO);
    const order = Number.isSafeInteger(billNo) && billNo > 0 ? await findOrderByProviderNum(billNo) : null;

    // Audit log before processing (payer account is stored only as a hash).
    await logPaymentEvent(PROVIDER, kind, order?.code ?? null, await sanitizePayload(fields, saltedHasher(cfg.ipHashSalt)));

    const refuse = async (reason: string) => {
      await logPaymentEvent(PROVIDER, "outcome", order?.code ?? null, { kind, result: reason });
      return textResponse(REFUSE);
    };

    if (!cfg.idram) {
      console.error("pay-callback-idram called but IDRAM_* secrets are not set");
      return refuse("NOT_CONFIGURED");
    }
    if (kind === "invalid") return refuse("INVALID_REQUEST");

    if (kind === "result" && !verifyIdramChecksum(fields, cfg.idram.secretKey)) {
      return refuse("BAD_CHECKSUM");
    }

    const alreadyThisPayment = order?.status === "paid" && order.provider === PROVIDER &&
      order.provider_payment_id === fields.EDP_TRANS_ID;

    const problem = idramOrderProblem({
      fields,
      expectedAccount: cfg.idram.accountId,
      order: order
        ? {
          amountAmd: order.amount_amd,
          payable: PAYABLE_STATUSES.includes(order.status) || (kind === "result" && alreadyThisPayment),
        }
        : null,
    });
    if (problem) return refuse(problem);

    if (kind === "precheck") {
      await logPaymentEvent(PROVIDER, "outcome", order!.code, { kind, result: "OK" });
      return textResponse(OK);
    }

    // kind === "result", checksum verified, amount matches.
    const amount = parseWholeAmd(fields.EDP_AMOUNT)!;
    const result = await confirmPayment(order!.code, PROVIDER, fields.EDP_TRANS_ID, amount);
    await logPaymentEvent(PROVIDER, "outcome", order!.code, { kind, result });
    if (!result.ok) {
      console.error("confirm_payment refused", order!.code, result.error);
      return textResponse(REFUSE);
    }
    return textResponse(OK);
  } catch (err) {
    console.error("pay-callback-idram error", err);
    return textResponse("ERROR", 500);
  }
});
