// GET order-status?code=... — the buyer's own order. The code is the capability.

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { normalizeOrderCode } from "../_shared/codes.ts";
import { findOrderByCode, getGiftShare } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";
import { giftShareAmd } from "../_shared/money.ts";

const cfg = getConfig();

Deno.serve(browserEndpoint(["GET"], cfg.cors, async (req) => {
  const url = new URL(req.url);
  const code = normalizeOrderCode(url.searchParams.get("code") ?? url.searchParams.get("c"));
  if (!code) throw new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("orderStatus", ipHash);

  const order = await findOrderByCode(code);
  if (!order) throw new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");

  // Paid: the amount actually recorded in gift_ledger. Not paid yet: the
  // share this order will contribute (same floor(20%) rule).
  const ledger = order.status === "paid" ? await getGiftShare(order.id) : null;

  return jsonResponse({
    code: order.code,
    status: order.status,
    product: order.product,
    amount_amd: order.amount_amd,
    burn_number: order.burn_number,
    text: order.text,
    // The wish itself is never returned: order links get shared.
    has_wish: order.wish_text !== null,
    recipient_name: order.recipient_name,
    created_at: order.created_at,
    paid_at: order.paid_at,
    gift_share_amd: ledger ?? giftShareAmd(order.amount_amd),
  });
}));
