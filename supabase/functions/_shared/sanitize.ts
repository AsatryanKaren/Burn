// Strips personal card data from provider payloads before they are stored in
// payment_events.payload. Pure module.
//
// Removed: masked card numbers, cardholder names, expiry, CVV, card binding
// ids, client emails/phones, IP addresses (ip, processing.?ip). Hashed (salted SHA-256, prefixed "sha256:"):
// payer account ids such as Idram's EDP_PAYER_ACCOUNT. Everything else
// (amounts, codes, ids, statuses, timestamps) is kept.

import { sha256Hex } from "./strings.ts";

const DROP_KEY_RE =
  /(card.?number|masked.?pan|^pan$|^pan.|card.?holder|holder.?name|client.?name|payer.?name|^name$|cvv|cvc|exp(iry|iration)?.?date|^exp$|card.?exp|email|phone|binding)/i;

// IP addresses of the buyer: "ip", "IP", "ProcessingIP", "processing_ip", ...
const DROP_IP_KEY_RE = /^ip$|processing.?ip/i;

const HASH_KEYS = new Set(["edp_payer_account", "payeraccount", "payer_account"]);

export type Hasher = (value: string) => Promise<string>;

export function saltedHasher(salt: string): Hasher {
  return async (value: string) => `sha256:${await sha256Hex(`${salt}:${value}`)}`;
}

export function shouldDropKey(key: string): boolean {
  return DROP_KEY_RE.test(key) || DROP_IP_KEY_RE.test(key);
}

export async function sanitizePayload(value: unknown, hash: Hasher): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => sanitizePayload(v, hash)));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (shouldDropKey(k)) continue;
      if (HASH_KEYS.has(k.toLowerCase())) {
        out[k] = v === null || v === undefined || v === "" ? v : await hash(String(v));
        continue;
      }
      out[k] = await sanitizePayload(v, hash);
    }
    return out;
  }
  return value;
}
