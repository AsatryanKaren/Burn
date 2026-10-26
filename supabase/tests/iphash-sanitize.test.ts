import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, expandIpv6, hashIp, rateLimitSubject } from "../functions/_shared/iphash.ts";
import { sanitizePayload, saltedHasher, shouldDropKey } from "../functions/_shared/sanitize.ts";
import { timingSafeEqual } from "../functions/_shared/strings.ts";

test("client IP from proxy headers", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientIp(new Headers({ "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" })), "5.6.7.8");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("IPv6 expansion and /64 grouping", () => {
  assert.deepEqual(expandIpv6("2001:db8::1"), ["2001", "0db8", "0000", "0000", "0000", "0000", "0000", "0001"]);
  assert.equal(expandIpv6("1.2.3.4"), null);
  assert.equal(expandIpv6("1::2::3"), null);
  assert.equal(rateLimitSubject("2001:db8:1:2:aaaa::1"), "2001:0db8:0001:0002::/64");
  assert.equal(rateLimitSubject("2001:db8:1:2:bbbb::9"), "2001:0db8:0001:0002::/64");
  assert.equal(rateLimitSubject("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(rateLimitSubject(" 1.2.3.4 "), "1.2.3.4");
});

test("IP hash is salted sha256 hex and never the raw IP", async () => {
  const a = await hashIp("1.2.3.4", "salt1");
  const b = await hashIp("1.2.3.4", "salt2");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(a, await hashIp("1.2.3.4", "salt1"));
  assert.ok(!a.includes("1.2.3.4"));
  await assert.rejects(() => hashIp("1.2.3.4", ""));
});

test("card data is removed from bank payloads", async () => {
  const hash = saltedHasher("s");
  const out = (await sanitizePayload(
    {
      PaymentID: "pid",
      Amount: 500,
      ResponseCode: "00",
      OrderStatus: 2,
      DateTime: "2026-12-31T23:59:59",
      CardNumber: "4111****1111",
      MaskedPan: "4111****1111",
      Pan: "4111****1111",
      ClientName: "ARAM ARAMYAN",
      CardHolderName: "ARAM",
      CardHolder: "ARAM",
      CardHolderID: "binding",
      ExpDate: "12/29",
      nested: { cardNumber: "x", ok: 1 },
      list: [{ ClientName: "x", Amount: 1 }],
    },
    hash,
  )) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ["Amount", "DateTime", "OrderStatus", "PaymentID", "ResponseCode", "list", "nested"]);
  assert.deepEqual(out.nested, { ok: 1 });
  assert.deepEqual(out.list, [{ Amount: 1 }]);
});

test("Idram payer account is kept only as a hash", async () => {
  const out = (await sanitizePayload(
    { EDP_PAYER_ACCOUNT: "987654321", EDP_AMOUNT: "500", EDP_TRANS_ID: "1", EDP_TRANS_DATE: "d", EDP_CHECKSUM: "c" },
    saltedHasher("s"),
  )) as Record<string, string>;
  assert.match(out.EDP_PAYER_ACCOUNT, /^sha256:[0-9a-f]{64}$/);
  assert.equal(out.EDP_AMOUNT, "500");
  assert.equal(out.EDP_TRANS_ID, "1");
  assert.equal(out.EDP_TRANS_DATE, "d");
  assert.equal(shouldDropKey("EDP_TRANS_DATE"), false);
  assert.equal(shouldDropKey("OrderID"), false);
});

test("timing safe equal", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});
