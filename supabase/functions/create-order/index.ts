// POST create-order — save a paper and start its payment.
// Contract: docs/ARCHITECTURE.md "POST create-order".

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { validateOrderInput } from "../_shared/validation.ts";
import { initialModeration, moderate } from "../_shared/moderation.ts";
import { generateOrderCode } from "../_shared/codes.ts";
import { providerReady } from "../_shared/config.ts";
import { getProduct, insertOrder } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";
import { paymentInstruction, paymentMisconfiguredError } from "../_shared/payments.ts";

const cfg = getConfig();

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  if (!providerReady(cfg)) {
    console.error(`PAYMENT_PROVIDER=${cfg.provider} is missing its secrets`);
    throw paymentMisconfiguredError();
  }

  const body = await readJson(req);
  const disabled = cfg.provider === "disabled";

  const v = validateOrderInput(body, { emailRequired: disabled });
  if (!v.ok) throw new ApiError(400, v.code, v.message);
  const input = v.value;

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("order", ipHash);

  const mod = moderate({ text: input.text, wish_text: input.wish_text, recipient_name: input.recipient_name });
  if (mod.decision === "rejected") {
    throw new ApiError(400, ErrorCode.TEXT_REJECTED, "This text can't be accepted. Please rephrase it.");
  }

  // Price comes from the database, never from the browser.
  const product = await getProduct(input.product);
  if (!product || !product.active) {
    throw new ApiError(400, ErrorCode.PRODUCT_UNAVAILABLE, "This option is not available right now.");
  }

  const order = await insertOrder(
    {
      product: input.product,
      amount_amd: product.price_amd,
      status: disabled ? "awaiting_launch" : "pending",
      lang: input.lang,
      email: input.email,
      text: input.text,
      wish_text: input.wish_text,
      recipient_name: input.recipient_name,
      show_on_stream: input.show_on_stream,
      moderation: initialModeration(mod, cfg.autoApprove),
      moderation_reason: mod.reason,
      provider: cfg.provider === "disabled" ? null : cfg.provider,
      ip_hash: ipHash,
    },
    () => generateOrderCode(),
  );

  const payment = await paymentInstruction(cfg, order, order.lang);

  return jsonResponse({
    code: order.code,
    amount_amd: order.amount_amd,
    status: order.status,
    payment,
  });
}));
