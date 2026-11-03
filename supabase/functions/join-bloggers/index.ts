// POST join-bloggers — a blogger/influencer applies to come along on the
// December 31 gift delivery (film it, tell their audience).
//
// Body: { name, link, platform?, audience?, email, phone?, message?, lang?, consent: true }
//   -> { ok: true }
// Validation: _shared/validation.ts validateBloggerInput (error codes in
// docs/BACKEND.md). Same answer for new and already-known emails (no
// enumeration); a repeated email just adds another row.
// Rate limit: 5 per IP hash per hour -> 429 RATE_LIMITED.
// After the row is saved, the application is also sent to the team's Telegram
// chat (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID); a Telegram failure is only logged.

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError } from "../_shared/errors.ts";
import { validateBloggerInput } from "../_shared/validation.ts";
import { addBloggerApplication } from "../_shared/db.ts";
import { enforceRateLimit, requestIpHash } from "../_shared/ratelimit.ts";
import { bloggerMessage, sendTelegram } from "../_shared/telegram.ts";

const cfg = getConfig();

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  const body = await readJson(req);
  const v = validateBloggerInput(body);
  if (!v.ok) throw new ApiError(400, v.code, v.message, v.field);

  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  await enforceRateLimit("bloggers", ipHash);

  await addBloggerApplication({ ...v.value, ip_hash: ipHash });
  if (cfg.telegram) await sendTelegram(cfg.telegram, bloggerMessage(v.value));
  return jsonResponse({ ok: true });
}));
