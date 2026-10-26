// Function configuration parsed from environment variables. Pure module:
// `parseConfig` takes a plain env record (env.ts passes Deno.env.toObject()).

import type { AmeriaCredentials, IdramConfig, Lang, ProviderName } from "./types.ts";
import { type CorsConfig, parseCorsConfig } from "./cors.ts";

/** Idram EDP payment form action (override with IDRAM_ACTION_URL). */
export const IDRAM_DEFAULT_ACTION = "https://banking.idram.am/Payment/GetPayment";

export type Env = Record<string, string | undefined>;

export interface Config {
  provider: ProviderName;
  /** Site base URL without trailing slash, e.g. "https://example.am". */
  siteUrl: string;
  /** e.g. "https://<ref>.supabase.co/functions/v1" */
  functionsBase: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  cors: CorsConfig;
  /** Salt for IP hashes; never empty (falls back to a value derived from the service key). */
  ipHashSalt: string;
  ipHashSaltIsFallback: boolean;
  ameria: AmeriaCredentials | null;
  idram: IdramConfig | null;
  /** AUTO_APPROVE (default "1"): clean texts get moderation='approved' at creation. */
  autoApprove: boolean;
  /** ADMIN_TOKEN; null when unset or shorter than ADMIN_TOKEN_MIN_LENGTH (admin then always 401). */
  adminToken: string | null;
}

export const ADMIN_TOKEN_MIN_LENGTH = 32;

const PROVIDERS: readonly ProviderName[] = ["disabled", "mock", "ameria", "idram"];

export const SITE_URL_PLACEHOLDER = "https://example.invalid";

export function parseProvider(value: string | undefined): ProviderName {
  const v = (value ?? "").trim().toLowerCase();
  return (PROVIDERS as readonly string[]).includes(v) ? (v as ProviderName) : "disabled";
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export function parseConfig(env: Env): Config {
  const supabaseUrl = trimSlash(env.SUPABASE_URL ?? "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const siteUrl = trimSlash((env.SITE_URL ?? "").trim() || SITE_URL_PLACEHOLDER);

  const salt = (env.IP_HASH_SALT ?? "").trim();

  const ameria =
    env.AMERIA_CLIENT_ID && env.AMERIA_USERNAME && env.AMERIA_PASSWORD && env.AMERIA_API_BASE
      ? {
        clientId: env.AMERIA_CLIENT_ID,
        username: env.AMERIA_USERNAME,
        password: env.AMERIA_PASSWORD,
        apiBase: trimSlash(env.AMERIA_API_BASE),
      }
      : null;

  const idram = env.IDRAM_ACCOUNT_ID && env.IDRAM_SECRET_KEY
    ? {
      accountId: env.IDRAM_ACCOUNT_ID.trim(),
      secretKey: env.IDRAM_SECRET_KEY,
      actionUrl: (env.IDRAM_ACTION_URL ?? "").trim() || IDRAM_DEFAULT_ACTION,
    }
    : null;

  return {
    provider: parseProvider(env.PAYMENT_PROVIDER),
    siteUrl,
    functionsBase: `${supabaseUrl}/functions/v1`,
    supabaseUrl,
    serviceRoleKey,
    cors: parseCorsConfig({ ALLOWED_ORIGINS: env.ALLOWED_ORIGINS, ALLOW_LOCALHOST: env.ALLOW_LOCALHOST, SITE_URL: siteUrl }),
    // Fallback keeps hashes stable and secret even if IP_HASH_SALT is unset.
    ipHashSalt: salt || `fallback:${serviceRoleKey}`,
    ipHashSaltIsFallback: !salt,
    ameria,
    idram,
    autoApprove: (env.AUTO_APPROVE ?? "1").trim() !== "0",
    adminToken: (env.ADMIN_TOKEN ?? "").length >= ADMIN_TOKEN_MIN_LENGTH ? env.ADMIN_TOKEN! : null,
  };
}

/** True when the configured provider has everything it needs. */
export function providerReady(cfg: Config): boolean {
  switch (cfg.provider) {
    case "disabled":
    case "mock":
      return true;
    case "ameria":
      return cfg.ameria !== null;
    case "idram":
      return cfg.idram !== null;
  }
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/**
 * The buyer's order page: `${SITE_URL}/p/{code}` for Armenian (the default
 * language lives at the root) and `${SITE_URL}/{lang}/p/{code}` for en/ru.
 * The static site serves /p/?c=CODE; vercel.json must rewrite /p/:code to it.
 */
export function orderPageUrl(siteUrl: string, lang: Lang, code: string): string {
  const prefix = lang === "hy" ? "" : `/${lang}`;
  return `${trimSlash(siteUrl)}${prefix}/p/${encodeURIComponent(code)}`;
}

export function mockPayUrl(functionsBase: string, code: string): string {
  return `${functionsBase}/pay-mock?code=${encodeURIComponent(code)}`;
}

export function ameriaBackUrl(functionsBase: string): string {
  return `${functionsBase}/pay-return-ameria`;
}

/** Text shown on the bank page. Brand-neutral on purpose. */
export function paymentDescription(providerOrderNum: number | string): string {
  return `Order ${providerOrderNum}`;
}
