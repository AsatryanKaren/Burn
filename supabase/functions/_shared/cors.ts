// CORS origin policy. Pure module.
//
//   ALLOWED_ORIGINS        comma-separated origins; entries may use one leading
//                          wildcard label, e.g. "https://*.example.am".
//   SITE_URL               its origin is always allowed (unless it is a .invalid placeholder).
//   ALLOW_LOCALHOST        "1" also allows http://localhost:*, http://127.0.0.1:*, http://[::1]:*
//   ALLOW_VERCEL_PREVIEWS  "1" also allows any https://*.vercel.app origin (preview deployments).
//
// An empty ALLOWED_ORIGINS means SITE_URL's origin only — never "*", and no
// *.vercel.app or localhost unless their switch is set.

export interface CorsConfig {
  /** Exact origins ("https://a.b") or wildcard patterns ("https://*.vercel.app"). */
  origins: string[];
  allowLocalhost: boolean;
}

export const VERCEL_PREVIEW_ORIGIN = "https://*.vercel.app";

const LOCALHOST_RE = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

export const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-admin-token";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";

/** Returns the normalized origin ("scheme://host[:port]") of a URL, or null. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function flag(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true";
}

export function parseCorsConfig(env: {
  ALLOWED_ORIGINS?: string;
  ALLOW_LOCALHOST?: string;
  ALLOW_VERCEL_PREVIEWS?: string;
  SITE_URL?: string;
}): CorsConfig {
  const origins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, "").toLowerCase())
    .filter((s) => s.length > 0);

  const site = originOf(env.SITE_URL);
  if (site && !new URL(site).hostname.endsWith(".invalid") && !origins.includes(site)) {
    origins.push(site);
  }
  if (flag(env.ALLOW_VERCEL_PREVIEWS) && !origins.includes(VERCEL_PREVIEW_ORIGIN)) {
    origins.push(VERCEL_PREVIEW_ORIGIN);
  }

  return { origins, allowLocalhost: flag(env.ALLOW_LOCALHOST) };
}

function matchesPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) return origin === pattern;
  // Only "scheme://*.rest" is supported: the wildcard covers one or more labels.
  const m = /^(https?):\/\/\*\.([a-z0-9.-]+(?::\d{1,5})?)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, rest] = m;
  const prefix = `${scheme}://`;
  if (!origin.startsWith(prefix)) return false;
  const host = origin.slice(prefix.length);
  if (!host.endsWith(`.${rest}`)) return false;
  const sub = host.slice(0, host.length - rest.length - 1);
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(sub) && !sub.includes("..");
}

export function isOriginAllowed(origin: string | null | undefined, cfg: CorsConfig): boolean {
  if (!origin) return false;
  const o = origin.toLowerCase();
  if (cfg.allowLocalhost && LOCALHOST_RE.test(o)) return true;
  return cfg.origins.some((p) => matchesPattern(o, p));
}

/** CORS headers for a response. Only `Vary` when the origin is not allowed or absent. */
export function corsHeaders(origin: string | null | undefined, cfg: CorsConfig): Record<string, string> {
  if (!origin || !isOriginAllowed(origin, cfg)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
