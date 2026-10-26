// POST pay-callback-idram — Idram EDP RESULT_URL (precheck + payment result).
// Answers text/plain "OK" when accepted; anything else refuses.
// See _shared/idram.ts for the protocol and the go-live checklist.
//
// Hardening: body capped at 8 KB (413), 60 requests per caller IP hash per
// 10 minutes (429), and only whitelisted EDP_* fields (values cut to 200
// chars, payer account hashed) are written to payment_events.

import { getConfig } from "../_shared/env.ts";
import { textResponse } from "../_shared/http.ts";
import {
  classifyIdramRequest,
  idramOrderProblem,
  parseFormBody,
  verifyIdramChecksum,
} from "../_shared/idram.ts";
import { parseWholeAmd } from "../_shared/money.ts";
import {
  confirmPayment,
  findOrderByProviderNum,
  logNeedsRefund,
  logPaymentEvent,
  PAYABLE_STATUSES,
} from "../_shared/db.ts";
import { sanitizePayload, saltedHasher } from "../_shared/sanitize.ts";
import { BodyTooLargeError, readCappedText, whitelistCallbackFields } from "../_shared/callbacks.ts";
import { requestIpHash, withinRateLimit } from "../_shared/ratelimit.ts";

const cfg = getConfig();
const PROVIDER = "idram";
const OK = "OK";
const REFUSE = "FAIL";

async function parseFields(raw: string, type: string): Promise<Record<string, string>> {
  if (type.includes("multipart/form-data")) {
    const out: Record<string, string> = {};
    const form = await new Response(raw, { headers: { "content-type": type } }).formData();
    for (const [k, v] of form) if (typeof v === "string") out[k] = v;
    return out;
  }
  return parseFormBody(raw);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    let raw: string;
    try {
      raw = await readCappedText(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return textResponse(REFUSE, 413);
      throw err;
    }

    const ipHash = await requestIpHash(req, cfg.ipHashSalt);
    if (!(await withinRateLimit("idramCallback", ipHash))) return textResponse(REFUSE, 429);

    const fields = await parseFields(raw, req.headers.get("content-type") ?? "");
    const kind = classifyIdramRequest(fields);
    const billNo = Number(fields.EDP_BILL_NO);
    const order = Number.isSafeInteger(billNo) && billNo > 0 ? await findOrderByProviderNum(billNo) : null;

    // Audit log before processing: whitelisted EDP_* fields only, payer account hashed.
    await logPaymentEvent(
      PROVIDER,
      kind,
      order?.code ?? null,
      await sanitizePayload(whitelistCallbackFields(fields), saltedHasher(cfg.ipHashSalt)),
    );

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

    // A verified result for an order already paid by a different payment: the
    // buyer may have been charged twice. We refuse it (below) and flag it.
    if (kind === "result" && order?.status === "paid" && !alreadyThisPayment) {
      await logNeedsRefund(PROVIDER, order.code, fields.EDP_TRANS_ID ?? "", parseWholeAmd(fields.EDP_AMOUNT), {
        reason: "ORDER_PAID_BY_OTHER_PAYMENT",
      });
    }

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
      if (result.error === "ORDER_PAID_BY_OTHER_PAYMENT") {
        await logNeedsRefund(PROVIDER, order!.code, fields.EDP_TRANS_ID, amount, { reason: result.error });
      }
      return textResponse(REFUSE);
    }
    return textResponse(OK);
  } catch (err) {
    console.error("pay-callback-idram error", err);
    return textResponse("ERROR", 500);
  }
});
