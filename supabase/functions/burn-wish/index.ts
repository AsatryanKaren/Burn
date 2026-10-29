// POST burn-wish — the one wish a light order burns in the fire (0013).
// Body: { "code": "...", "text": "...", "show_on_stream": true, "lang": "hy" }
//   -> 200 { "ok": true, "burn_number": n, "already": bool }
//
// One payment (a light on the map) includes exactly one wish; a second call
// for the same order changes nothing and answers the first wish's number with
// already: true. The order code is the capability (as in order-status).
// Contract: docs/ARCHITECTURE.md "Wish in the fire (migration 0013)".
//   400 INVALID_JSON, CODE_INVALID, TEXT_REQUIRED, TEXT_TOO_LONG (not counted against limits)
//   429 RATE_LIMITED (20 per IP hash per hour, 10 per order code per hour)
//   400 TEXT_REJECTED (blocklist; nothing saved)
//   404 ORDER_NOT_FOUND
//   409 ORDER_NOT_LIGHT (not a light order), ORDER_NOT_PAID (status not paid / awaiting_launch)
// Moderation as for a paper's text: contact data / names -> hidden, else
// pending (approved only with AUTO_APPROVE=1). Public only when the order is
// paid, show_on_stream and moderation = 'approved'.

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { burnWishDecision, validateBurnWishInput } from "../_shared/firewish.ts";
import { initialModeration, moderate } from "../_shared/moderation.ts";
import { burnWish } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";

const cfg = getConfig();

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  const v = validateBurnWishInput(body);
  if (!v.ok) throw new ApiError(400, v.code, v.message);
  const input = v.value;

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("burnWish", ipHash);
  await enforceRateLimit("burnWishCode", input.code);

  const mod = moderate({ text: input.text });
  if (mod.decision === "rejected") {
    throw new ApiError(400, ErrorCode.TEXT_REJECTED, "This text can't be accepted. Please rephrase it.");
  }

  const rpc = await burnWish({
    code: input.code,
    text: input.text,
    show_on_stream: input.show_on_stream,
    lang: input.lang,
    moderation: initialModeration(mod, cfg.autoApprove),
    moderation_reason: mod.reason,
  });
  const d = burnWishDecision(rpc);
  if (!d.ok) {
    if (d.status === 500) console.error("burn_wish unexpected answer", rpc);
    throw new ApiError(d.status, d.code, d.message);
  }
  return jsonResponse(d.body);
}));
