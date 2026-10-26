// GET pay-mock?code=... — TEST ONLY. Exists only when PAYMENT_PROVIDER=mock
// (404 otherwise). Confirms the order as if the bank had approved it, then
// redirects to the order page. Idempotent (payment id = "mock-<code>").

import { getConfig } from "../_shared/env.ts";
import { errorResponse, redirectResponse } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { orderPageUrl } from "../_shared/config.ts";
import { normalizeOrderCode } from "../_shared/codes.ts";
import { confirmPayment, findOrderByCode, logPaymentEvent } from "../_shared/db.ts";

const cfg = getConfig();
const PROVIDER = "mock";

const notFound = () => errorResponse(new ApiError(404, ErrorCode.NOT_FOUND, "Not found."));

Deno.serve(async (req) => {
  if (cfg.provider !== "mock") return notFound();
  if (req.method !== "GET") {
    return errorResponse(new ApiError(405, ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."), { Allow: "GET" });
  }

  try {
    const code = normalizeOrderCode(new URL(req.url).searchParams.get("code"));
    if (!code) return notFound();

    await logPaymentEvent(PROVIDER, "confirm", code, { code });

    const order = await findOrderByCode(code);
    if (!order) return notFound();

    const result = await confirmPayment(order.code, PROVIDER, `mock-${order.code}`, order.amount_amd);
    await logPaymentEvent(PROVIDER, "outcome", order.code, { result });

    return redirectResponse(orderPageUrl(cfg.siteUrl, order.lang, order.code));
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error("pay-mock error", err);
    return errorResponse(new ApiError(500, ErrorCode.INTERNAL, "Something went wrong."));
  }
});
