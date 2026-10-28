// POST room-warmth — a visitor of a lit plot's 3D room sends warmth to its
// owner (once per IP hash per room), or the page counts a visit.
// Body: { "cell_id": 4321, "action": "warm" | "visit" }
//   warm  -> { "ok": true, "warmth": n, "already": bool }
//   visit -> { "ok": true, "visits": n }   (or { "ok": true } when rate-limited)
//
// Contract: docs/ARCHITECTURE.md "Warmth and visits (migration 0011)".
//   400 INVALID_JSON, CELL_INVALID, ACTION_INVALID (not counted against limits)
//   429 RATE_LIMITED (warm only: 30 per IP hash per hour)
//   404 NOT_LIT (no such plot, or the plot is not lit)
// Visits: 300 per IP hash per hour; over it the answer is { ok: true } with
// no counts and nothing is counted (best-effort).

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError } from "../_shared/errors.ts";
import { rateLimitedDecision, validateWarmthInput, warmthDecision, warmthLimitName } from "../_shared/warmth.ts";
import type { WarmthDecision } from "../_shared/warmth.ts";
import { addRoomVisit, addRoomWarmth } from "../_shared/db.ts";
import { requestIpHash, withinRateLimit } from "../_shared/ratelimit.ts";

const cfg = getConfig();

function respond(d: WarmthDecision): Response {
  if (!d.ok) throw new ApiError(d.status, d.code, d.message);
  return jsonResponse(d.body);
}

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  const v = validateWarmthInput(body);
  if (!v.ok) throw new ApiError(400, v.code, v.message);
  const { cell_id, action } = v.value;

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  if (!(await withinRateLimit(warmthLimitName(action), ipHash))) return respond(rateLimitedDecision(action));

  const rpc = action === "warm" ? await addRoomWarmth(cell_id, ipHash) : await addRoomVisit(cell_id);
  return respond(warmthDecision(action, rpc));
}));
