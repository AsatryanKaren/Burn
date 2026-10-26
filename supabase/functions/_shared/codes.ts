// Order codes. Pure module (uses only the Web Crypto global, present in Deno and Node).
//
// 16 characters of Crockford base32 in lowercase: digits plus letters without
// i, l, o, u. 32 symbols -> 5 bits each -> 80 bits of randomness. The code is
// the capability to view one's own order, so it must be unguessable.

export const ORDER_CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ORDER_CODE_LENGTH = 16;

const ORDER_CODE_RE = /^[0-9a-hjkmnp-tv-z]{16}$/;

export type RandomBytes = (n: number) => Uint8Array;

const defaultRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function generateOrderCode(randomBytes: RandomBytes = defaultRandom): string {
  const bytes = randomBytes(ORDER_CODE_LENGTH);
  if (bytes.length < ORDER_CODE_LENGTH) throw new Error("randomBytes returned too few bytes");
  let out = "";
  for (let i = 0; i < ORDER_CODE_LENGTH; i++) {
    // 256 is a multiple of 32, so masking keeps the distribution uniform.
    out += ORDER_CODE_ALPHABET[bytes[i] & 31];
  }
  return out;
}

export function isValidOrderCode(value: unknown): value is string {
  return typeof value === "string" && ORDER_CODE_RE.test(value);
}

/**
 * Normalizes a code typed or pasted by a human: trims, lower-cases and maps
 * the Crockford look-alikes (i/l -> 1, o -> 0). Returns null if still invalid.
 */
export function normalizeOrderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const c = value.trim().toLowerCase().replace(/[il]/g, "1").replace(/o/g, "0");
  return isValidOrderCode(c) ? c : null;
}
