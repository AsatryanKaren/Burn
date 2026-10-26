// POST start-payment — start (or restart) payment for an existing order.
// Body: { "code": "...", "lang": "hy" }
//
// Used by the launch emails ("burn your saved paper") and so that someone
// else can pay from the order link. Disabled provider: returns
// { code, status, payment: { mode: "disabled" } } and changes nothing.
// Otherwise the order moves to `pending` and `payment` has the same shape as
// in create-order. 404 unknown code, 409 ALREADY_PAID / ORDER_NOT_PAYABLE.
// Lights: the plot is (re-)held for 30 minutes before payment starts; if
// another order has it -> 409 CELL_TAKEN.

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { normalizeOrderCode } from "../_shared/codes.ts";
import { isLightProduct, parseLang } from "../_shared/validation.ts";
import { providerReady } from "../_shared/config.ts";
import { beginPaymentAttempt, findOrderByCode, holdCell, PAYABLE_STATUSES } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";
import { paymentInstruction, paymentMisconfiguredError } from "../_shared/payments.ts";

const cfg = getConfig();

function notFound(): ApiError {
  return new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");
}

function alreadyPaid(): ApiError {
  return new ApiError(409, ErrorCode.ALREADY_PAID, "This paper is already paid.");
}

function notPayable(): ApiError {
  return new ApiError(409, ErrorCode.ORDER_NOT_PAYABLE, "This order can no longer be paid.");
}

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const code = normalizeOrderCode(b.code);
  if (!code) throw notFound();

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("startPayment", ipHash);

  const order = await findOrderByCode(code);
  if (!order) throw notFound();
  if (order.status === "paid") throw alreadyPaid();
  if (!PAYABLE_STATUSES.includes(order.status)) throw notPayable();

  if (cfg.provider === "disabled") {
    return jsonResponse({ code: order.code, status: order.status, payment: { mode: "disabled" } });
  }
  if (!providerReady(cfg)) {
    console.error(`PAYMENT_PROVIDER=${cfg.provider} is missing its secrets`);
    throw paymentMisconfiguredError();
  }

  // Lights: re-take the plot for this order (free, expired, or already ours).
  if (isLightProduct(order.product) && order.cell_id !== null) {
    const held = await holdCell(order.id, order.cell_id);
    if (!held) {
      throw new ApiError(409, ErrorCode.CELL_TAKEN, "This plot was taken by someone else. Please choose another one.");
    }
  }

  // Ameriabank needs a fresh numeric OrderID for every InitPayment.
  const attempt = await beginPaymentAttempt(code, cfg.provider, cfg.provider === "ameria");
  if (!attempt.ok) {
    if (attempt.error === "ORDER_NOT_FOUND") throw notFound();
    if (attempt.error === "ALREADY_PAID") throw alreadyPaid();
    if (attempt.error === "ORDER_NOT_PAYABLE") throw notPayable();
    throw new ApiError(500, ErrorCode.INTERNAL, "Something went wrong. Please try again.");
  }

  const lang = parseLang(b.lang, attempt.lang);
  const payment = await paymentInstruction(cfg, attempt, lang);

  return jsonResponse({ code: attempt.code, status: attempt.status, payment });
}));
