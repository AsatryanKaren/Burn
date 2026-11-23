// GET/POST pay-return-ameria — Ameriabank vPOS BackURL.
//
// The query string (orderID, paymentID, resposneCode, opaque) is untrusted.
// We ask the bank server-to-server (GetPaymentDetails) and only then call
// confirm_payment. Always ends with a 302 to the buyer's result page
// (/payment/success|failed|pending/?c=CODE), or to the site root when the
// order can't be identified. The bank reaches us at
// https://lightarmenia.com/payment/return/, which vercel.json passes through.
//
// Hardening: body / query capped at 8 KB (413), 600 requests per caller IP
// hash per 10 minutes (429), only whitelisted keys (orderID, paymentID,
// resposneCode/responseCode, opaque; values cut to 200 chars) are logged, and
// the bank is asked only when `opaque` is an existing order code or `orderID`
// is one of our payment attempts.

import { getConfig } from "../_shared/env.ts";
import { redirectResponse, textResponse } from "../_shared/http.ts";
import { orderPageUrl } from "../_shared/config.ts";
import { isValidOrderCode } from "../_shared/codes.ts";
import { parseBackUrlParams } from "../_shared/ameria.ts";
import { settleAmeriaPayment } from "../_shared/ameria-settle.ts";
import {
  ameriaOrderIdsForOrder,
  findOrderByCode,
  findOrderByProviderNum,
  logPaymentEvent,
  type OrderRow,
  orderCodeForAmeriaOrderId,
} from "../_shared/db.ts";
import { ameriaPaymentDetails, ameriaSettleDeps, sanitizeForLog } from "../_shared/payments.ts";
import {
  BodyTooLargeError,
  CALLBACK_MAX_BODY_BYTES,
  readCappedText,
  whitelistCallbackFields,
} from "../_shared/callbacks.ts";
import { requestIpHash, withinRateLimit } from "../_shared/ratelimit.ts";

const cfg = getConfig();
const PROVIDER = "ameria";

/** Query string + (POST) form/JSON body. Throws BodyTooLargeError above 8 KB. */
async function readParams(req: Request): Promise<URLSearchParams> {
  const search = new URL(req.url).search;
  if (search.length > CALLBACK_MAX_BODY_BYTES) throw new BodyTooLargeError();
  const params = new URLSearchParams(search);
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    const raw = await readCappedText(req);
    try {
      if (type.includes("application/x-www-form-urlencoded")) {
        for (const [k, v] of new URLSearchParams(raw)) if (!params.has(k)) params.set(k, v);
      } else if (type.includes("application/json")) {
        const body = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(body ?? {})) if (!params.has(k)) params.set(k, String(v));
      }
    } catch {
      // Malformed body: fall back to the query string.
    }
  }
  return params;
}

/** True when the return refers to one of our payment attempts (by code or by Ameria OrderID). */
async function refersToOurAttempt(hintedOrder: OrderRow | null, orderIdParam: string | null): Promise<boolean> {
  if (hintedOrder) return true;
  const orderId = Number(orderIdParam);
  if (!orderIdParam || !Number.isSafeInteger(orderId) || orderId <= 0) return false;
  if (await findOrderByProviderNum(orderId)) return true;
  return (await orderCodeForAmeriaOrderId(orderId)) !== null;
}

/** Finds our order for the bank's details: by Opaque (we set it to the code), then by OrderID. */
async function resolveOrder(details: Record<string, unknown>): Promise<OrderRow | null> {
  const opaque = typeof details.Opaque === "string" ? details.Opaque.trim() : "";
  if (isValidOrderCode(opaque)) {
    const o = await findOrderByCode(opaque);
    if (o) return o;
  }
  const orderId = Number(details.OrderID);
  if (!Number.isSafeInteger(orderId)) return null;
  const byNum = await findOrderByProviderNum(orderId);
  if (byNum) return byNum;
  const code = await orderCodeForAmeriaOrderId(orderId);
  return code ? findOrderByCode(code) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  const home = `${cfg.siteUrl}/`;

  try {
    let params: URLSearchParams;
    try {
      params = await readParams(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return textResponse("Payload too large", 413);
      throw err;
    }

    const ipHash = await requestIpHash(req, cfg.ipHashSalt);
    if (!(await withinRateLimit("ameriaReturn", ipHash))) {
      return textResponse("Too many requests", 429, { "Retry-After": "600" });
    }

    const back = parseBackUrlParams(params);
    const hinted = back.opaque && isValidOrderCode(back.opaque) ? back.opaque : null;

    // 1. Audit log before anything else (whitelisted keys only).
    await logPaymentEvent(PROVIDER, "return", hinted, await sanitizeForLog(cfg, whitelistCallbackFields(Object.fromEntries(params))));

    const hintedOrder = hinted ? await findOrderByCode(hinted) : null;
    const fallbackUrl = hintedOrder ? orderPageUrl(cfg.siteUrl, hintedOrder.lang, hintedOrder.code, "pending") : home;

    if (!cfg.ameria) {
      console.error("pay-return-ameria called but AMERIA_* secrets are not set");
      return redirectResponse(fallbackUrl);
    }
    if (!back.paymentId || !/^[A-Za-z0-9-]{8,64}$/.test(back.paymentId)) {
      await logPaymentEvent(PROVIDER, "outcome", hinted, { result: "NO_PAYMENT_ID" });
      return redirectResponse(fallbackUrl);
    }

    // Only ask the bank about payments we started.
    if (!(await refersToOurAttempt(hintedOrder, back.orderId))) {
      await logPaymentEvent(PROVIDER, "outcome", hinted, { result: "UNKNOWN_ORDER" });
      return redirectResponse(fallbackUrl);
    }

    // 2. Ask the bank.
    let details: Record<string, unknown>;
    try {
      details = (await ameriaPaymentDetails(cfg.ameria, back.paymentId)) as Record<string, unknown>;
    } catch (err) {
      console.error("GetPaymentDetails failed", err);
      await logPaymentEvent(PROVIDER, "details_error", hinted, {
        PaymentID: back.paymentId,
        error: String(err).slice(0, 300),
      });
      return redirectResponse(fallbackUrl);
    }

    const order = await resolveOrder(details);
    await logPaymentEvent(PROVIDER, "details", order?.code ?? hinted, {
      PaymentID: back.paymentId,
      details: await sanitizeForLog(cfg, details),
    });
    if (!order) {
      await logPaymentEvent(PROVIDER, "outcome", hinted, { PaymentID: back.paymentId, result: "ORDER_NOT_FOUND" });
      return redirectResponse(fallbackUrl);
    }

    // 3. Settle with the bank (shared with ameria-reconcile). The bank's OrderID
    // must be one we sent for this order (current or an earlier attempt).
    // Which result page to show: the page still asks the server for the real
    // status, and a pending page switches by itself once the order is paid or failed.
    const { result: outcome } = await settleAmeriaPayment(ameriaSettleDeps(cfg, cfg.ameria), order, back.paymentId, details, {
      knownOrderIds: [order.provider_order_num, ...(await ameriaOrderIdsForOrder(order.code))],
      mayMarkFailed: true,
      logPending: true,
    });

    return redirectResponse(orderPageUrl(cfg.siteUrl, order.lang, order.code, outcome));
  } catch (err) {
    console.error("pay-return-ameria error", err);
    return redirectResponse(home);
  }
});
