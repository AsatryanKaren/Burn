// Runtime configuration from Deno.env (impure; Deno only).

import { type Config, parseConfig } from "./config.ts";

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  cached = parseConfig(Deno.env.toObject());
  if (!cached.supabaseUrl || !cached.serviceRoleKey) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }
  if (cached.ipHashSaltIsFallback) {
    console.warn("IP_HASH_SALT is not set; using a fallback derived from the service role key");
  }
  return cached;
}
