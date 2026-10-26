import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminTokenMatches,
  awaitingLaunchCsv,
  csvField,
  parseListOrders,
  parseModerate,
  waitlistCsv,
} from "../functions/_shared/admin.ts";

test("admin token comparison", () => {
  const t = "a".repeat(40);
  assert.equal(adminTokenMatches(t, t), true);
  assert.equal(adminTokenMatches(t, t + "x"), false);
  assert.equal(adminTokenMatches(t, null), false);
  assert.equal(adminTokenMatches(null, ""), false);
  assert.equal(adminTokenMatches(null, null), false);
});

test("list_orders params", () => {
  const ok = parseListOrders({ status: "paid", moderation: "pending", q: "  aram ", limit: 999, before_id: 10 });
  assert.deepEqual(ok, { ok: true, value: { status: "paid", moderation: "pending", q: "aram", limit: 200, before_id: 10 } });
  assert.deepEqual(parseListOrders({}), { ok: true, value: { status: null, moderation: null, q: null, limit: 50, before_id: null } });
  assert.equal(parseListOrders({ status: "nope" }).ok, false);
  assert.equal(parseListOrders({ moderation: "x" }).ok, false);
  assert.equal(parseListOrders({ limit: 0 }).ok, false);
  assert.equal(parseListOrders({ before_id: -1 }).ok, false);
});

test("moderate params", () => {
  assert.deepEqual(parseModerate({ code: "0123456789ABCDEF", moderation: "approved" }), {
    ok: true,
    value: { code: "0123456789abcdef", moderation: "approved", reason: null },
  });
  assert.equal(parseModerate({ code: "0123456789abcdef", moderation: "pending" }).ok, false);
  assert.equal(parseModerate({ code: "bad", moderation: "hidden" }).ok, false);
});

test("csv quoting and formula-injection guard", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('a,"b"'), '"a,""b"""');
  assert.equal(csvField("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvField("+374"), `"'+374"`);
  assert.equal(csvField(null), "");
  assert.equal(csvField(500), "500");
});

test("csv exports", () => {
  assert.equal(
    waitlistCsv([{ email: "a@b.am", lang: "hy", created_at: "2026-10-27T00:00:00Z" }]),
    "email,lang,created_at\r\na@b.am,hy,2026-10-27T00:00:00Z\r\n",
  );
  const csv = awaitingLaunchCsv("https://site.am", [
    { email: "a@b.am", lang: "hy", code: "0123456789abcdef", product: "burn", amount_amd: 500, created_at: "t" },
    { email: "c@d.am", lang: "en", code: "fedcba9876543210", product: "gift", amount_amd: 900, created_at: "t" },
  ]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "email,lang,code,product,amount_amd,link,created_at");
  assert.equal(lines[1], "a@b.am,hy,0123456789abcdef,burn,500,https://site.am/p/0123456789abcdef,t");
  assert.equal(lines[2], "c@d.am,en,fedcba9876543210,gift,900,https://site.am/en/p/fedcba9876543210,t");
});
