// Per-IP-hash rate limits (impure: uses the database).

import { ApiError, ErrorCode } from "./errors.ts";
import { clientIp, hashIp } from "./iphash.ts";
import { rateLimitAllows } from "./db.ts";

export const LIMITS = {
  order: { limit: 8, windowSeconds: 600 },
  startPayment: { limit: 8, windowSeconds: 600 },
  waitlist: { limit: 5, windowSeconds: 600 },
  bloggers: { limit: 5, windowSeconds: 3600 },
  orderStatus: { limit: 120, windowSeconds: 600 },
  room: { limit: 60, windowSeconds: 3600 },
  roomWarm: { limit: 30, windowSeconds: 3600 },
  roomVisit: { limit: 300, windowSeconds: 3600 },
  // burn-wish (0013): per IP hash, and per order code (key `burnWishCode:<code>`).
  burnWish: { limit: 20, windowSeconds: 3600 },
  burnWishCode: { limit: 10, windowSeconds: 3600 },
  // Bank-facing endpoints (per caller IP hash).
  ameriaReturn: { limit: 60, windowSeconds: 600 },
  idramCallback: { limit: 60, windowSeconds: 600 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Salted SHA-256 of the client IP (never the raw IP). */
export function requestIpHash(req: Request, salt: string): Promise<string> {
  return hashIp(clientIp(req.headers), salt);
}

/**
 * Throws 429 RATE_LIMITED when the caller exceeded the named limit. `subject`
 * is usually the IP hash; per-order limits pass the order code.
 */
export async function enforceRateLimit(name: LimitName, subject: string): Promise<void> {
  const { limit, windowSeconds } = LIMITS[name];
  const allowed = await rateLimitAllows(`${name}:${subject}`, limit, windowSeconds);
  if (!allowed) {
    throw new ApiError(429, ErrorCode.RATE_LIMITED, "Too many requests. Please wait a few minutes and try again.");
  }
}

/** Counts the call against the named limit; false when it is over the limit. */
export function withinRateLimit(name: LimitName, ipHash: string): Promise<boolean> {
  const { limit, windowSeconds } = LIMITS[name];
  return rateLimitAllows(`${name}:${ipHash}`, limit, windowSeconds);
}
