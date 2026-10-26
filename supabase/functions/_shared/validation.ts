// Request validation. Pure module.

import type { Lang, ProductCode, Result } from "./types.ts";
import { ErrorCode } from "./errors.ts";

export const LANGS: readonly Lang[] = ["hy", "en", "ru"];
export const PRODUCT_CODES: readonly ProductCode[] = ["burn", "burn_wish", "gift", "midnight"];
export const PRODUCTS_WITH_WISH: readonly ProductCode[] = ["burn_wish", "midnight"];
export const PRODUCTS_WITH_RECIPIENT: readonly ProductCode[] = ["gift"];

export const TEXT_MAX = 120;
export const WISH_MAX = 200;
export const RECIPIENT_MAX = 40;
export const EMAIL_MAX = 254;

// Invisible characters that only serve to hide or reorder text: zero-width
// space, LRM/RLM, bidi embeddings/overrides/isolates, word joiner and other
// invisible operators, BOM, soft hyphen. ZWJ/ZWNJ are kept (emoji sequences,
// some scripts).
const INVISIBLE_RE = /[­​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// C0/C1 control characters (includes \n, \r, \t).
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Normalizes user text: NFC, drops invisible characters, turns control
 * characters (newlines, tabs) into spaces, collapses whitespace, trims.
 * Non-strings become "".
 */
export function normalizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(INVISIBLE_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Length in Unicode code points (same as Postgres char_length). */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function parseLang(value: unknown, fallback: Lang = "hy"): Lang {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "am" || v === "hye") return "hy";
    if ((LANGS as readonly string[]).includes(v)) return v as Lang;
  }
  return fallback;
}

export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === "string" && (PRODUCT_CODES as readonly string[]).includes(value);
}

const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Returns the normalized (trimmed, lower-cased) email or null if invalid. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  return EMAIL_RE.test(email) ? email : null;
}

export interface OrderInput {
  product: ProductCode;
  text: string;
  wish_text: string | null;
  recipient_name: string | null;
  email: string | null;
  lang: Lang;
  show_on_stream: boolean;
}

export interface OrderValidationOptions {
  /** True when payments are disabled: we need the email to send the link at launch. */
  emailRequired: boolean;
}

function fail<T>(code: string, message: string): Result<T> {
  return { ok: false, code, message };
}

function isEmptyOptional(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && normalizeText(v) === "");
}

/** Validates the create-order request body. */
export function validateOrderInput(body: unknown, opts: OrderValidationOptions): Result<OrderInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (b.consent !== true) {
    return fail(ErrorCode.CONSENT_REQUIRED, "Consent is required.");
  }

  if (!isProductCode(b.product)) {
    return fail(ErrorCode.INVALID_PRODUCT, "Unknown product.");
  }
  const product = b.product;

  const text = normalizeText(b.text);
  if (text === "") return fail(ErrorCode.TEXT_REQUIRED, "Text is required.");
  if (charLength(text) > TEXT_MAX) {
    return fail(ErrorCode.TEXT_TOO_LONG, `Text must be at most ${TEXT_MAX} characters.`);
  }

  let wish_text: string | null = null;
  if (PRODUCTS_WITH_WISH.includes(product)) {
    wish_text = normalizeText(b.wish_text);
    if (wish_text === "") return fail(ErrorCode.WISH_REQUIRED, "A wish is required for this option.");
    if (charLength(wish_text) > WISH_MAX) {
      return fail(ErrorCode.WISH_TOO_LONG, `Wish must be at most ${WISH_MAX} characters.`);
    }
  } else if (!isEmptyOptional(b.wish_text)) {
    return fail(ErrorCode.WISH_NOT_ALLOWED, "This option does not include a wish.");
  }

  let recipient_name: string | null = null;
  if (PRODUCTS_WITH_RECIPIENT.includes(product)) {
    recipient_name = normalizeText(b.recipient_name);
    if (recipient_name === "") {
      return fail(ErrorCode.RECIPIENT_REQUIRED, "Recipient name is required for a gift.");
    }
    if (charLength(recipient_name) > RECIPIENT_MAX) {
      return fail(ErrorCode.RECIPIENT_TOO_LONG, `Recipient name must be at most ${RECIPIENT_MAX} characters.`);
    }
  } else if (!isEmptyOptional(b.recipient_name)) {
    return fail(ErrorCode.RECIPIENT_NOT_ALLOWED, "This option does not include a recipient.");
  }

  let email: string | null = null;
  if (isEmptyOptional(b.email)) {
    if (opts.emailRequired) {
      return fail(ErrorCode.EMAIL_REQUIRED, "Email is required so we can send your payment link at launch.");
    }
  } else {
    email = normalizeEmail(b.email);
    if (email === null) return fail(ErrorCode.EMAIL_INVALID, "Email address is not valid.");
  }

  return {
    ok: true,
    value: {
      product,
      text,
      wish_text,
      recipient_name,
      email,
      lang: parseLang(b.lang),
      show_on_stream: b.show_on_stream === true,
    },
  };
}

export interface WaitlistInput {
  email: string;
  lang: Lang;
}

export function validateWaitlistInput(body: unknown): Result<WaitlistInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;
  if (isEmptyOptional(b.email)) return fail(ErrorCode.EMAIL_REQUIRED, "Email is required.");
  const email = normalizeEmail(b.email);
  if (email === null) return fail(ErrorCode.EMAIL_INVALID, "Email address is not valid.");
  return { ok: true, value: { email, lang: parseLang(b.lang) } };
}
