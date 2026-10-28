// Warmth and visits of a lit plot's 3D room (room-warmth). Pure module.
// Contract: docs/ARCHITECTURE.md "Warmth and visits (migration 0011)".

import { ErrorCode } from "./errors.ts";
import type { Result } from "./types.ts";
import { parseCellId } from "./validation.ts";

export const ROOM_ACTIONS = ["warm", "visit"] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

export interface WarmthInput {
  cell_id: number;
  action: RoomAction;
}

/**
 * Body { cell_id, action: "warm" | "visit" }. Checks in this order:
 * object (INVALID_JSON), cell_id (CELL_INVALID: an integer 0–999999, or a
 * string of digits, as in create-order), action (ACTION_INVALID: exact,
 * case-sensitive). Whether the plot exists and is lit is decided by the
 * database (NOT_LIT).
 */
export function validateWarmthInput(body: unknown): Result<WarmthInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: ErrorCode.INVALID_JSON, message: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const cell_id = parseCellId(b.cell_id);
  if (cell_id === null) return { ok: false, code: ErrorCode.CELL_INVALID, message: "This plot is not on the map." };
  if (typeof b.action !== "string" || !(ROOM_ACTIONS as readonly string[]).includes(b.action)) {
    return { ok: false, code: ErrorCode.ACTION_INVALID, message: 'action must be "warm" or "visit".' };
  }
  return { ok: true, value: { cell_id, action: b.action as RoomAction } };
}

/** The rate limit (LIMITS in ratelimit.ts) each action counts against. */
export function warmthLimitName(action: RoomAction): "roomWarm" | "roomVisit" {
  return action === "warm" ? "roomWarm" : "roomVisit";
}

export interface WarmthResponse {
  ok: true;
  warmth?: number;
  already?: boolean;
  visits?: number;
}

export type WarmthDecision =
  | { ok: true; body: WarmthResponse }
  | { ok: false; status: 404 | 429 | 500; code: string; message: string };

/**
 * Over the rate limit: visits are best-effort, so a visit still answers
 * { ok: true } (no counts, nothing counted); a warm answers 429.
 */
export function rateLimitedDecision(action: RoomAction): WarmthDecision {
  if (action === "visit") return { ok: true, body: { ok: true } };
  return {
    ok: false,
    status: 429,
    code: ErrorCode.RATE_LIMITED,
    message: "Too many requests. Please wait a few minutes and try again.",
  };
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Maps the answer of room_add_warmth / room_add_visit to the HTTP answer:
 *   { ok: true, warmth, already } -> 200 { ok, warmth, already }   (warm)
 *   { ok: true, visits }          -> 200 { ok, visits }            (visit)
 *   { ok: false, error: NOT_LIT } -> 404 NOT_LIT
 *   anything else                 -> 500 INTERNAL
 */
export function warmthDecision(action: RoomAction, rpc: unknown): WarmthDecision {
  const internal: WarmthDecision = {
    ok: false,
    status: 500,
    code: ErrorCode.INTERNAL,
    message: "Something went wrong. Please try again.",
  };
  if (typeof rpc !== "object" || rpc === null || Array.isArray(rpc)) return internal;
  const r = rpc as Record<string, unknown>;
  if (r.ok === false && r.error === "NOT_LIT") {
    return { ok: false, status: 404, code: ErrorCode.NOT_LIT, message: "This plot is not lit." };
  }
  if (r.ok !== true) return internal;
  if (action === "warm") {
    if (!isCount(r.warmth) || typeof r.already !== "boolean") return internal;
    return { ok: true, body: { ok: true, warmth: r.warmth, already: r.already } };
  }
  if (!isCount(r.visits)) return internal;
  return { ok: true, body: { ok: true, visits: r.visits } };
}
