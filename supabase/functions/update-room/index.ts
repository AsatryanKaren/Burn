// POST update-room — the buyer rearranges the 3D room of their light.
// Body: { "code": "...", "room": { v, wall, floor, glow, items } } -> { "ok": true }
//
// The order code is the capability (as in order-status / start-payment).
// Contract: docs/ARCHITECTURE.md "The room (3D room of a light)".
//   400 INVALID_JSON, ROOM_INVALID (validateRoom)
//   404 NOT_FOUND (unknown or malformed code)
//   409 ORDER_NOT_EDITABLE (not a light, or status not awaiting_launch | pending | paid)
//   429 RATE_LIMITED (60 per IP hash per hour; invalid rooms are not counted)
// The room is structured data only (no free text), so it is not moderated.

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { normalizeOrderCode } from "../_shared/codes.ts";
import { checkRoomEditable, ROOM_EDITABLE_STATUSES, validateRoom } from "../_shared/validation.ts";
import { findOrderByCode, updateOrderRoom } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";

const cfg = getConfig();

function notFound(): ApiError {
  return new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");
}

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  const code = normalizeOrderCode(b.code);
  if (!code) throw notFound();

  const room = validateRoom(b.room);
  if (!room.ok) throw new ApiError(400, room.code, room.message);

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("room", ipHash);

  const order = await findOrderByCode(code);
  const decision = checkRoomEditable(order);
  if (!decision.ok) throw new ApiError(decision.status, decision.code, decision.message);

  // Conditional update: if the order was cancelled/refunded in between, nothing changes.
  const updated = await updateOrderRoom(order!.id, room.value, ROOM_EDITABLE_STATUSES);
  if (!updated) {
    throw new ApiError(409, ErrorCode.ORDER_NOT_EDITABLE, "This room can no longer be changed.");
  }

  return jsonResponse({ ok: true });
}));
