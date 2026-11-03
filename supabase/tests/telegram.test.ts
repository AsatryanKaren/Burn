import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../functions/_shared/config.ts";
import { bloggerMessage, sendTelegram, TELEGRAM_TEXT_MAX } from "../functions/_shared/telegram.ts";
import type { BloggerInput } from "../functions/_shared/validation.ts";

const app: BloggerInput = {
  name: "Ani Petrosyan",
  link: "https://instagram.com/ani",
  platform: "instagram",
  audience: null,
  email: "ani@mail.am",
  phone: null,
  message: null,
  lang: "hy",
};

test("telegram config needs both token and chat id", () => {
  assert.equal(parseConfig({}).telegram, null);
  assert.equal(parseConfig({ TELEGRAM_BOT_TOKEN: "123:abc" }).telegram, null);
  assert.equal(parseConfig({ TELEGRAM_CHAT_ID: "42" }).telegram, null);
  assert.deepEqual(parseConfig({ TELEGRAM_BOT_TOKEN: " 123:abc ", TELEGRAM_CHAT_ID: " 42 " }).telegram, { botToken: "123:abc", chatId: "42" });
});

test("application message lists every field, with dashes for empty ones", () => {
  assert.equal(
    bloggerMessage(app),
    "🎁 New gift delivery application\nName: Ani Petrosyan\nPlatform: instagram · https://instagram.com/ani\nEmail: ani@mail.am\nPhone: —\nLanguage: hy",
  );
  const bare = bloggerMessage({ ...app, link: null, platform: null, phone: "+374 91 123456" });
  assert.ok(bare.includes("Platform: —\n") && bare.includes("Phone: +374 91 123456"));
  assert.ok(bloggerMessage({ ...app, message: "x".repeat(5000) }).length <= TELEGRAM_TEXT_MAX);
});

test("sendTelegram posts to the bot and never throws", async () => {
  const tg = { botToken: "123:abc", chatId: "42" };
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  const ok = await sendTelegram(tg, "hi", (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(String(init.body)) };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);
  assert.equal(ok, true);
  assert.equal(seen!.url, "https://api.telegram.org/bot123:abc/sendMessage");
  assert.equal(seen!.body.chat_id, "42");
  assert.equal(seen!.body.text, "hi");

  const errors: string[] = [];
  const orig = console.error;
  console.error = (m: string) => errors.push(m);
  try {
    assert.equal(await sendTelegram(tg, "hi", (async () => new Response("", { status: 403 })) as unknown as typeof fetch), false);
    assert.equal(await sendTelegram(tg, "hi", (async () => { throw new TypeError("net"); }) as unknown as typeof fetch), false);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(errors, ["telegram: HTTP 403", "telegram: TypeError"]);
  assert.ok(errors.every((m) => !m.includes("123:abc")));
});
