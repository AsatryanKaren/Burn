// Per-IP-hash rate limits (impure: uses the database).

import { ApiError, ErrorCode } from "./errors.ts";
import { clientIp, hashIp } from "./iphash.ts";
import { rateLimitAllows } from "./db.ts";

export const LIMITS = {
  order: { limit: 8, windowSeconds: 600 },
  startPayment: { limit: 8, windowSeconds: 600 },
  waitlist: { limit: 5, windowSeconds: 600 },
  orderStatus: { limit: 120, windowSeconds: 600 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Salted SHA-256 of the client IP (never the raw IP). */
export function requestIpHash(req: Request, salt: string): Promise<string> {
  return hashIp(clientIp(req.headers), salt);
}

/** Throws 429 RATE_LIMITED when the caller exceeded the named limit. */
export async function enforceRateLimit(name: LimitName, ipHash: string): Promise<void> {
  const { limit, windowSeconds } = LIMITS[name];
  const allowed = await rateLimitAllows(`${name}:${ipHash}`, limit, windowSeconds);
  if (!allowed) {
    throw new ApiError(429, ErrorCode.RATE_LIMITED, "Too many requests. Please wait a few minutes and try again.");
  }
}
