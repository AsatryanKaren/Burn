// Client IP extraction and salted hashing. Pure module.
// The raw IP is never stored: only sha256("<salt>:<ip>").

import { sha256Hex } from "./strings.ts";

/**
 * Best-effort client IP from proxy headers. Supabase Edge Functions sit behind
 * a proxy that sets x-forwarded-for; the left-most entry is the client.
 */
export function clientIp(headers: Headers): string {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return "unknown";
}

/** Expands an IPv6 address to 8 groups of 4 hex digits; null if not IPv6. */
export function expandIpv6(ip: string): string[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0"));
}

/**
 * The value that is hashed for rate limiting: IPv4 as-is, IPv6 reduced to its
 * /64 prefix (one subscriber usually owns a whole /64).
 */
export function rateLimitSubject(ip: string): string {
  const v6 = expandIpv6(ip);
  if (v6) {
    // IPv4-mapped addresses: use the IPv4 address.
    if (v6.slice(0, 5).every((g) => g === "0000") && v6[5] === "ffff") {
      const a = parseInt(v6[6], 16), b = parseInt(v6[7], 16);
      return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    return `${v6.slice(0, 4).join(":")}::/64`;
  }
  return ip.trim();
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  if (!salt) throw new Error("hashIp: salt is required");
  return sha256Hex(`${salt}:${rateLimitSubject(ip)}`);
}
