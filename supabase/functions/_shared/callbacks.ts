// Helpers for the bank-facing endpoints (pay-return-ameria, pay-callback-idram).
// Pure module: Web APIs only.
//
//   * bodies are capped at 8 KB (declared Content-Length and actual size)
//   * what the caller sent is logged to payment_events only after a key
//     whitelist (EDP_*, orderID, paymentID, resposneCode/responseCode, opaque)
//     with every value cut to 200 characters

export const CALLBACK_MAX_BODY_BYTES = 8 * 1024;
export const CALLBACK_MAX_VALUE_CHARS = 200;
export const CALLBACK_MAX_KEYS = 50;

const ALLOWED_KEYS = new Set(["orderid", "paymentid", "resposnecode", "responsecode", "opaque"]);

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

/** Reads the body as text; throws BodyTooLargeError above `maxBytes`. */
export async function readCappedText(req: Request, maxBytes = CALLBACK_MAX_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function isLoggableCallbackKey(key: string): boolean {
  return /^EDP_[A-Z0-9_]{1,40}$/i.test(key) || ALLOWED_KEYS.has(key.toLowerCase());
}

/** Whitelisted keys only, values as strings cut to 200 chars, at most 50 keys. */
export function whitelistCallbackFields(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (!isLoggableCallbackKey(k)) continue;
    if (n++ >= CALLBACK_MAX_KEYS) break;
    const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v) ?? "";
    out[k] = Array.from(s).slice(0, CALLBACK_MAX_VALUE_CHARS).join("");
  }
  return out;
}
