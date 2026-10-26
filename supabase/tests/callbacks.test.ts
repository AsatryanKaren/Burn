import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BodyTooLargeError,
  CALLBACK_MAX_BODY_BYTES,
  isLoggableCallbackKey,
  readCappedText,
  whitelistCallbackFields,
} from "../functions/_shared/callbacks.ts";

test("callback log whitelist", () => {
  for (const k of ["EDP_BILL_NO", "edp_amount", "EDP_PAYER_ACCOUNT", "orderID", "OrderId", "paymentID", "resposneCode", "responseCode", "opaque"]) {
    assert.ok(isLoggableCallbackKey(k), k);
  }
  for (const k of ["cardholder", "ip", "evil", "EDP_", "x-EDP_A", "__proto__", "EDP_" + "A".repeat(41)]) {
    assert.ok(!isLoggableCallbackKey(k), k);
  }
  const out = whitelistCallbackFields({
    EDP_BILL_NO: "100001",
    opaque: "x".repeat(500),
    junk: "drop me",
    orderID: 7,
  });
  assert.deepEqual(Object.keys(out), ["EDP_BILL_NO", "opaque", "orderID"]);
  assert.equal(out.opaque.length, 200);
  assert.equal(out.orderID, "7");
  // cut by code points, not UTF-16 units
  assert.equal(Array.from(whitelistCallbackFields({ opaque: "🔥".repeat(300) }).opaque).length, 200);
});

test("readCappedText enforces 8 KB on declared and actual length", async () => {
  const ok = new Request("https://x/", { method: "POST", body: "a=1" });
  assert.equal(await readCappedText(ok), "a=1");
  const big = "a".repeat(CALLBACK_MAX_BODY_BYTES + 1);
  await assert.rejects(readCappedText(new Request("https://x/", { method: "POST", body: big })), BodyTooLargeError);
  const lying = new Request("https://x/", { method: "POST", body: "a", headers: { "content-length": "999999" } });
  await assert.rejects(readCappedText(lying), BodyTooLargeError);
  // streamed body without content-length
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < 9; i++) c.enqueue(new TextEncoder().encode("b".repeat(1024)));
      c.close();
    },
  });
  await assert.rejects(
    readCappedText(new Request("https://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit)),
    BodyTooLargeError,
  );
  assert.equal(await readCappedText(new Request("https://x/")), "");
});
