// POST create-order — save a paper (or a light on a map plot) and start its payment.
// Contract: docs/ARCHITECTURE.md "POST create-order" and "Light up Armenia".
// Lights may carry an optional `room` (validateRoom; ROOM_INVALID), papers
// must not (ROOM_NOT_ALLOWED).

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import {
  checkProductAvailable,
  isLightProduct,
  type LightOrderInput,
  type OrderInput,
  validateOrderInput,
} from "../_shared/validation.ts";
import { initialModeration, moderate } from "../_shared/moderation.ts";
import { generateOrderCode } from "../_shared/codes.ts";
import { providerReady } from "../_shared/config.ts";
import { cancelPendingOrder, getCell, getProduct, holdCell, insertOrder, type NewOrder } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";
import { paymentInstruction, paymentMisconfiguredError } from "../_shared/payments.ts";

const cfg = getConfig();

function cellTaken(): ApiError {
  return new ApiError(409, ErrorCode.CELL_TAKEN, "This plot was just taken. Please choose another one.");
}

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

  const light: LightOrderInput | null = isLightProduct(input.product) ? input as LightOrderInput : null;
  const paper: OrderInput | null = light ? null : input as OrderInput;

  const mod = light
    ? moderate({ text: light.text, light_signature: light.light_signature })
    : moderate({ text: paper!.text, wish_text: paper!.wish_text, recipient_name: paper!.recipient_name });
  if (mod.decision === "rejected") {
    if (mod.field === "signature") {
      throw new ApiError(400, ErrorCode.SIGNATURE_REJECTED, "This signature can't be accepted. Please change it.");
    }
    throw new ApiError(400, ErrorCode.TEXT_REJECTED, "This text can't be accepted. Please rephrase it.");
  }

  // Price comes from the database, never from the browser. Inactive products
  // (no longer sold, rows kept for old orders) -> 400 PRODUCT_UNAVAILABLE.
  const available = checkProductAvailable(await getProduct(input.product));
  if (!available.ok) throw new ApiError(400, available.code, available.message);
  const product = available.value;

  if (light) {
    const cell = await getCell(light.cell_id);
    if (!cell) throw new ApiError(400, ErrorCode.CELL_INVALID, "This plot is not on the map.");
    // Fast path; the authoritative check is hold_cell below.
    if (cell.status !== "free") throw cellTaken();
  }

  const common = {
    product: input.product,
    amount_amd: product.price_amd,
    status: disabled ? "awaiting_launch" as const : "pending" as const,
    lang: input.lang,
    email: input.email,
    text: input.text,
    moderation: initialModeration(mod, cfg.autoApprove),
    moderation_reason: mod.reason,
    provider: cfg.provider === "disabled" ? null : cfg.provider,
    ip_hash: ipHash,
  };
  const row: Omit<NewOrder, "code"> = light
    ? {
      ...common,
      wish_text: null,
      recipient_name: null,
      show_on_stream: false, // ignored for lights
      cell_id: light.cell_id,
      light_icon: light.light_icon,
      light_color: light.light_color,
      light_signature: light.light_signature,
      room: light.room,
    }
    : {
      ...common,
      wish_text: paper!.wish_text,
      recipient_name: paper!.recipient_name,
      show_on_stream: paper!.show_on_stream,
    };

  const order = await insertOrder(row, () => generateOrderCode());

  // Payments open: reserve the plot for 30 minutes. Payments disabled
  // (awaiting_launch): nothing is held, the design and email are saved.
  if (light && !disabled) {
    const held = await holdCell(order.id, light.cell_id);
    if (!held) {
      await cancelPendingOrder(order.id);
      throw cellTaken();
    }
  }

  const payment = await paymentInstruction(cfg, order, order.lang);

  return jsonResponse({
    code: order.code,
    amount_amd: order.amount_amd,
    status: order.status,
    payment,
  });
}));
