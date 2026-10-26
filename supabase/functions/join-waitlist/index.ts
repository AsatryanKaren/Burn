// POST join-waitlist — { email, lang } -> { ok: true }.
// The response is the same for new and already-known emails (no enumeration).

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError } from "../_shared/errors.ts";
import { validateWaitlistInput } from "../_shared/validation.ts";
import { addToWaitlist } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";

const cfg = getConfig();

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  const v = validateWaitlistInput(body);
  if (!v.ok) throw new ApiError(400, v.code, v.message);

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("waitlist", ipHash);

  await addToWaitlist({ email: v.value.email, lang: v.value.lang, ip_hash: ipHash });
  return jsonResponse({ ok: true });
}));
