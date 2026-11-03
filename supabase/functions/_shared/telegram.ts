// Team notifications in a private Telegram chat (Bot API sendMessage).
// The database stays the source of truth: a failed send is logged, never thrown.

import type { TelegramConfig } from "./config.ts";
import type { BloggerInput } from "./validation.ts";

/** Telegram's limit for one message. */
export const TELEGRAM_TEXT_MAX = 4096;
const TIMEOUT_MS = 5000;

/** Plain text (no parse_mode), so user input needs no escaping. */
export function bloggerMessage(a: BloggerInput): string {
  const lines = [
    "🎁 New gift delivery application",
    `Name: ${a.name}`,
    `Platform: ${a.platform ?? "—"}${a.link ? ` · ${a.link}` : ""}`,
    `Email: ${a.email}`,
    `Phone: ${a.phone ?? "—"}`,
    `Language: ${a.lang}`,
  ];
  if (a.audience) lines.push(`Audience: ${a.audience}`);
  if (a.message) lines.push("", a.message);
  return lines.join("\n").slice(0, TELEGRAM_TEXT_MAX);
}

/** Returns true when Telegram accepted the message. */
export async function sendTelegram(
  tg: TelegramConfig,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: tg.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`telegram: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    // Never log the URL: it contains the bot token.
    console.error(`telegram: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}
