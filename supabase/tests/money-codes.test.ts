import { test } from "node:test";
import assert from "node:assert/strict";
import { giftShareAmd, parseWholeAmd } from "../functions/_shared/money.ts";
import {
  generateOrderCode,
  isValidOrderCode,
  normalizeOrderCode,
  ORDER_CODE_ALPHABET,
} from "../functions/_shared/codes.ts";

test("gift share is floor(20%)", () => {
  assert.equal(giftShareAmd(500), 100);
  assert.equal(giftShareAmd(1900), 380);
  assert.equal(giftShareAmd(900), 180);
  assert.equal(giftShareAmd(2900), 580);
  assert.equal(giftShareAmd(999), 199);
  assert.equal(giftShareAmd(4), 0);
  assert.equal(giftShareAmd(0), 0);
  assert.throws(() => giftShareAmd(1.5));
  assert.throws(() => giftShareAmd(-1));
});

test("parseWholeAmd accepts exact integers only", () => {
  assert.equal(parseWholeAmd("500"), 500);
  assert.equal(parseWholeAmd("500.00"), 500);
  assert.equal(parseWholeAmd(500), 500);
  assert.equal(parseWholeAmd(500.0), 500);
  assert.equal(parseWholeAmd("500.5"), null);
  assert.equal(parseWholeAmd(500.5), null);
  assert.equal(parseWholeAmd("-500"), null);
  assert.equal(parseWholeAmd("5e2"), null);
  assert.equal(parseWholeAmd(""), null);
  assert.equal(parseWholeAmd(null), null);
});

test("order codes: 16 chars of lowercase Crockford base32", () => {
  assert.equal(ORDER_CODE_ALPHABET.length, 32);
  assert.doesNotMatch(ORDER_CODE_ALPHABET, /[ilou]/);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = generateOrderCode();
    assert.equal(c.length, 16);
    assert.ok(isValidOrderCode(c), c);
    seen.add(c);
  }
  assert.equal(seen.size, 2000);
});

test("order code generation uses every symbol uniformly from the byte source", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => ((i * 32) + 31) & 0xff); // low 5 bits always 31
  const c = generateOrderCode(() => bytes);
  assert.equal(c, "z".repeat(16));
  const c2 = generateOrderCode(() => Uint8Array.from({ length: 16 }, (_, i) => i));
  assert.equal(c2, "0123456789abcdef");
  assert.throws(() => generateOrderCode(() => new Uint8Array(4)));
});

test("order code validation and normalization", () => {
  assert.equal(isValidOrderCode("0123456789abcdef"), true);
  assert.equal(isValidOrderCode("0123456789ABCDEF"), false);
  assert.equal(isValidOrderCode("0123456789abcdei"), false);
  assert.equal(isValidOrderCode("0123456789abcde"), false);
  assert.equal(isValidOrderCode(null), false);
  assert.equal(normalizeOrderCode(" 0123456789ABCDEF "), "0123456789abcdef");
  assert.equal(normalizeOrderCode("O123456789abcdeL"), "0123456789abcde1");
  assert.equal(normalizeOrderCode("short"), null);
  assert.equal(normalizeOrderCode(42), null);
});
