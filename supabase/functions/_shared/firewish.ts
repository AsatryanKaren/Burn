// The one wish a light order burns in the fire (burn-wish, migration 0013).
// Pure module. Contract: docs/ARCHITECTURE.md "Wish in the fire (migration 0013)".

import { ErrorCode } from "./errors.ts";
import type { Lang, Result } from "./types.ts";
import { normalizeOrderCode } from "./codes.ts";
import { charLength, normalizeText, parseLang, TEXT_MAX } from "./validation.ts";

/** Same limit as a paper's text (fire_wishes_text_len). */
export const FIRE_WISH_MAX = TEXT_MAX;

export interface BurnWishInput {
  code: string;
  text: string;
  show_on_stream: boolean;
  lang: Lang;
}

/**
 * Body { code, text, show_on_stream?, lang? }. Checks in this order:
 * object (INVALID_JSON), code (CODE_INVALID: 16 chars of Crockford base32,
 * normalized like every code input), text (normalized like a paper's text:
 * TEXT_REQUIRED when empty, TEXT_TOO_LONG over 120 characters).
 * show_on_stream defaults to true; only `false` turns it off.
 * lang: hy | en | ru, default hy.
 */
export function validateBurnWishInput(body: unknown): Result<BurnWishInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: ErrorCode.INVALID_JSON, message: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  const code = normalizeOrderCode(b.code);
  if (!code) return { ok: false, code: ErrorCode.CODE_INVALID, message: "This order code is not valid." };

  const text = normalizeText(b.text);
  if (text === "") return { ok: false, code: ErrorCode.TEXT_REQUIRED, message: "Text is required." };
  if (charLength(text) > FIRE_WISH_MAX) {
    return { ok: false, code: ErrorCode.TEXT_TOO_LONG, message: `Text must be at most ${FIRE_WISH_MAX} characters.` };
  }

  return {
    ok: true,
    value: { code, text, show_on_stream: b.show_on_stream !== false, lang: parseLang(b.lang) },
  };
}

export interface BurnWishResponse {
  ok: true;
  burn_number: number;
  already: boolean;
}

export type BurnWishDecision =
  | { ok: true; body: BurnWishResponse }
  | { ok: false; status: 404 | 409 | 500; code: string; message: string };

const RPC_ERRORS: Record<string, { status: 404 | 409; code: string; message: string }> = {
  ORDER_NOT_FOUND: { status: 404, code: ErrorCode.ORDER_NOT_FOUND, message: "Order not found." },
  ORDER_NOT_LIGHT: {
    status: 409,
    code: ErrorCode.ORDER_NOT_LIGHT,
    message: "Only a light on the map comes with a wish in the fire.",
  },
  ORDER_NOT_PAID: {
    status: 409,
    code: ErrorCode.ORDER_NOT_PAID,
    message: "This order is not paid yet.",
  },
};

/**
 * Maps the burn_wish RPC answer to the HTTP answer:
 *   { ok: true, burn_number, already }        -> 200 { ok, burn_number, already }
 *   { ok: false, error: ORDER_NOT_FOUND }     -> 404 ORDER_NOT_FOUND
 *   { ok: false, error: ORDER_NOT_LIGHT }     -> 409 ORDER_NOT_LIGHT
 *   { ok: false, error: ORDER_NOT_PAID }      -> 409 ORDER_NOT_PAID
 *   anything else (INVALID_ARGS, bad shape)   -> 500 INTERNAL
 */
export function burnWishDecision(rpc: unknown): BurnWishDecision {
  const internal: BurnWishDecision = {
    ok: false,
    status: 500,
    code: ErrorCode.INTERNAL,
    message: "Something went wrong. Please try again.",
  };
  if (typeof rpc !== "object" || rpc === null || Array.isArray(rpc)) return internal;
  const r = rpc as Record<string, unknown>;
  if (r.ok === false) {
    const e = typeof r.error === "string" && Object.hasOwn(RPC_ERRORS, r.error) ? RPC_ERRORS[r.error] : undefined;
    return e ? { ok: false, ...e } : internal;
  }
  if (r.ok !== true) return internal;
  if (typeof r.burn_number !== "number" || !Number.isInteger(r.burn_number) || r.burn_number < 1) return internal;
  if (typeof r.already !== "boolean") return internal;
  return { ok: true, body: { ok: true, burn_number: r.burn_number, already: r.already } };
}

/** fire_wishes columns order-status reads. */
export interface FireWishRow {
  burn_number: number;
  text: string;
  show_on_stream: boolean;
  created_at: string;
}

export interface FireWishView {
  burn_number: number;
  text: string;
  show_on_stream: boolean;
  created_at: string;
}

/**
 * order-status `fire` field for a light order: the wish as the code holder
 * wrote it, or null when there is none. Moderation state is not exposed.
 * The burn number of a wish saved before payment (awaiting_launch) is
 * provisional: it changes once when the order is paid.
 */
export function fireWishView(row: FireWishRow | null | undefined): FireWishView | null {
  if (!row) return null;
  return {
    burn_number: row.burn_number,
    text: row.text,
    show_on_stream: row.show_on_stream,
    created_at: row.created_at,
  };
}
