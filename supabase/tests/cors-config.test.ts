import { test } from "node:test";
import assert from "node:assert/strict";
import { corsHeaders, isOriginAllowed, parseCorsConfig } from "../functions/_shared/cors.ts";
import { readFileSync } from "node:fs";
import { ameriaBackUrl, orderPageUrl, parseConfig, parseProvider, providerReady } from "../functions/_shared/config.ts";

test("empty ALLOWED_ORIGINS means SITE_URL only, never *", () => {
  const cfg = parseCorsConfig({ ALLOWED_ORIGINS: "", SITE_URL: "https://real.am" });
  assert.equal(isOriginAllowed("https://real.am", cfg), true);
  assert.equal(isOriginAllowed("https://burn-git-main-x.vercel.app", cfg), false);
  assert.equal(isOriginAllowed("http://localhost:8000", cfg), false);
  assert.equal(isOriginAllowed("https://evil.com", cfg), false);
  assert.equal(isOriginAllowed(null, cfg), false);
  // placeholder SITE_URL and nothing else: no browser origin at all
  const none = parseCorsConfig({ ALLOWED_ORIGINS: "", SITE_URL: "https://example.invalid" });
  assert.deepEqual(none.origins, []);
  assert.equal(none.allowLocalhost, false);
  assert.equal(isOriginAllowed("https://example.invalid", none), false);
});

test("ALLOW_VERCEL_PREVIEWS and ALLOW_LOCALHOST switches", () => {
  const cfg = parseCorsConfig({ SITE_URL: "https://real.am", ALLOW_VERCEL_PREVIEWS: "1", ALLOW_LOCALHOST: "1" });
  assert.equal(isOriginAllowed("https://burn-git-main-x.vercel.app", cfg), true);
  assert.equal(isOriginAllowed("http://localhost:8000", cfg), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:3000", cfg), true);
  assert.equal(isOriginAllowed("http://x.vercel.app", cfg), false);
  assert.equal(isOriginAllowed("https://vercel.app", cfg), false);
  assert.equal(isOriginAllowed("https://x.vercel.app.evil.com", cfg), false);
  const off = parseCorsConfig({ SITE_URL: "https://real.am", ALLOW_VERCEL_PREVIEWS: "0", ALLOW_LOCALHOST: "0" });
  assert.equal(isOriginAllowed("https://x.vercel.app", off), false);
  assert.equal(isOriginAllowed("http://localhost:8000", off), false);
});

test("explicit origins", () => {
  const cfg = parseCorsConfig({ ALLOWED_ORIGINS: "https://site.am, https://www.site.am/", ALLOW_LOCALHOST: "0" });
  assert.equal(isOriginAllowed("https://site.am", cfg), true);
  assert.equal(isOriginAllowed("https://www.site.am", cfg), true);
  assert.equal(isOriginAllowed("https://x.vercel.app", cfg), false);
  assert.equal(isOriginAllowed("http://localhost:8000", cfg), false);
  const withLocal = parseCorsConfig({ ALLOWED_ORIGINS: "https://site.am", ALLOW_LOCALHOST: "1" });
  assert.equal(isOriginAllowed("http://localhost:5173", withLocal), true);
});

test("SITE_URL origin is always allowed", () => {
  const cfg = parseCorsConfig({ ALLOWED_ORIGINS: "https://a.am", SITE_URL: "https://real.am/" });
  assert.equal(isOriginAllowed("https://real.am", cfg), true);
});

test("cors headers", () => {
  const cfg = parseCorsConfig({ ALLOW_LOCALHOST: "1" });
  const h = corsHeaders("http://localhost:8000", cfg);
  assert.equal(h["Access-Control-Allow-Origin"], "http://localhost:8000");
  assert.match(h["Access-Control-Allow-Headers"], /apikey/);
  assert.deepEqual(corsHeaders("https://evil.com", cfg), { Vary: "Origin" });
});

test("config defaults are safe", () => {
  const cfg = parseConfig({ SUPABASE_URL: "https://ref.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.equal(cfg.provider, "disabled");
  assert.equal(cfg.siteUrl, "https://example.invalid");
  assert.equal(cfg.functionsBase, "https://ref.supabase.co/functions/v1");
  assert.equal(cfg.ipHashSaltIsFallback, true);
  assert.ok(cfg.ipHashSalt.length > 0);
  assert.equal(providerReady(cfg), true);
  assert.equal(parseProvider("AMERIA"), "ameria");
  assert.equal(parseProvider("paypal"), "disabled");
  assert.equal(providerReady(parseConfig({ PAYMENT_PROVIDER: "ameria" })), false);
  assert.equal(providerReady(parseConfig({ PAYMENT_PROVIDER: "idram", IDRAM_ACCOUNT_ID: "1", IDRAM_SECRET_KEY: "s" })), true);
  assert.equal(cfg.autoApprove, false);
  assert.equal(parseConfig({ AUTO_APPROVE: "0" }).autoApprove, false);
  assert.equal(parseConfig({ AUTO_APPROVE: "yes" }).autoApprove, false);
  assert.equal(parseConfig({ AUTO_APPROVE: " 1 " }).autoApprove, true);
  assert.deepEqual(cfg.cors, { origins: [], allowLocalhost: false });
  assert.ok(parseConfig({ ALLOW_VERCEL_PREVIEWS: "1" }).cors.origins.includes("https://*.vercel.app"));
  assert.equal(cfg.adminToken, null);
  assert.equal(parseConfig({ ADMIN_TOKEN: "short" }).adminToken, null);
  assert.equal(parseConfig({ ADMIN_TOKEN: "x".repeat(32) }).adminToken, "x".repeat(32));
});

test("order page URL", () => {
  assert.equal(orderPageUrl("https://site.am/", "hy", "abc"), "https://site.am/p/abc");
  assert.equal(orderPageUrl("https://site.am", "en", "abc"), "https://site.am/en/p/abc");
  assert.equal(orderPageUrl("https://site.am", "ru", "abc"), "https://site.am/ru/p/abc");
});

test("after the bank the buyer lands on a result page on our domain", () => {
  assert.equal(orderPageUrl("https://site.am/", "hy", "abc", "success"), "https://site.am/payment/success/?c=abc");
  assert.equal(orderPageUrl("https://site.am", "en", "abc", "failed"), "https://site.am/en/payment/failed/?c=abc");
  assert.equal(orderPageUrl("https://site.am", "ru", "abc", "pending"), "https://site.am/ru/payment/pending/?c=abc");
  assert.equal(ameriaBackUrl("https://lightarmenia.com/"), "https://lightarmenia.com/payment/return/");
});

test("vercel.json passes /payment/return/ to pay-return-ameria and keeps result pages private", () => {
  const v = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const site = JSON.parse(readFileSync(new URL("../../site/config/site.json", import.meta.url), "utf8"));
  const fn = `${site.supabase.url}/functions/v1/pay-return-ameria`;
  for (const source of ["/payment/return", "/payment/return/"]) {
    assert.equal(v.rewrites.find((r: { source: string }) => r.source === source)?.destination, fn, source);
  }
  const priv = v.headers.find((h: { source: string }) => h.source.includes("payment"));
  const keys = Object.fromEntries(priv.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  assert.equal(keys["X-Robots-Tag"], "noindex");
  assert.equal(keys["Referrer-Policy"], "no-referrer");
});
