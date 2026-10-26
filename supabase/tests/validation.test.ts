import { test } from "node:test";
import assert from "node:assert/strict";
import {
  charLength,
  normalizeEmail,
  normalizeText,
  parseLang,
  validateOrderInput,
  validateWaitlistInput,
} from "../functions/_shared/validation.ts";

const base = { product: "burn", text: "fear of failing", consent: true, lang: "en", show_on_stream: true };
const opt = { emailRequired: false };

function errCode(r: ReturnType<typeof validateOrderInput>): string | null {
  return r.ok ? null : r.code;
}

test("normalizeText trims, collapses whitespace and removes invisible characters", () => {
  assert.equal(normalizeText("  a \n\t b  "), "a b");
  assert.equal(normalizeText("a​b‮c"), "abc");
  assert.equal(normalizeText("é"), "é");
  assert.equal(normalizeText(42), "");
  assert.equal(normalizeText(null), "");
});

test("charLength counts code points like Postgres char_length", () => {
  assert.equal(charLength("abc"), 3);
  assert.equal(charLength("Թող"), 3);
  assert.equal(charLength("🔥🔥"), 2);
});

test("valid burn order", () => {
  const r = validateOrderInput(base, opt);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, {
      product: "burn",
      text: "fear of failing",
      wish_text: null,
      recipient_name: null,
      email: null,
      lang: "en",
      show_on_stream: true,
    });
  }
});

test("consent must be exactly true", () => {
  assert.equal(errCode(validateOrderInput({ ...base, consent: "true" }, opt)), "CONSENT_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, consent: undefined }, opt)), "CONSENT_REQUIRED");
});

test("body and product", () => {
  assert.equal(errCode(validateOrderInput(null, opt)), "INVALID_JSON");
  assert.equal(errCode(validateOrderInput([], opt)), "INVALID_JSON");
  assert.equal(errCode(validateOrderInput({ ...base, product: "free" }, opt)), "INVALID_PRODUCT");
});

test("text length 1..120 after normalization", () => {
  assert.equal(errCode(validateOrderInput({ ...base, text: "   " }, opt)), "TEXT_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, text: "ա".repeat(121) }, opt)), "TEXT_TOO_LONG");
  assert.ok(validateOrderInput({ ...base, text: "ա".repeat(120) }, opt).ok);
  // whitespace collapse happens before the length check
  assert.ok(validateOrderInput({ ...base, text: "a" + " ".repeat(200) + "b" }, opt).ok);
});

test("wish rules", () => {
  assert.equal(errCode(validateOrderInput({ ...base, product: "burn_wish" }, opt)), "WISH_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, product: "midnight", wish_text: "x".repeat(201) }, opt)), "WISH_TOO_LONG");
  assert.equal(errCode(validateOrderInput({ ...base, wish_text: "peace" }, opt)), "WISH_NOT_ALLOWED");
  assert.ok(validateOrderInput({ ...base, wish_text: "" }, opt).ok);
  assert.ok(validateOrderInput({ ...base, wish_text: null }, opt).ok);
  const r = validateOrderInput({ ...base, product: "burn_wish", wish_text: " peace " }, opt);
  assert.ok(r.ok && r.value.wish_text === "peace");
});

test("recipient rules", () => {
  assert.equal(errCode(validateOrderInput({ ...base, product: "gift" }, opt)), "RECIPIENT_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, product: "gift", recipient_name: "x".repeat(41) }, opt)), "RECIPIENT_TOO_LONG");
  assert.equal(errCode(validateOrderInput({ ...base, recipient_name: "Mom" }, opt)), "RECIPIENT_NOT_ALLOWED");
  assert.ok(validateOrderInput({ ...base, product: "gift", recipient_name: "Mom" }, opt).ok);
});

test("email optional unless payments are disabled", () => {
  assert.equal(errCode(validateOrderInput(base, { emailRequired: true })), "EMAIL_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, email: "nope" }, opt)), "EMAIL_INVALID");
  const r = validateOrderInput({ ...base, email: " Someone@Mail.AM " }, { emailRequired: true });
  assert.ok(r.ok && r.value.email === "someone@mail.am");
});

test("lang falls back to hy", () => {
  assert.equal(parseLang("ru"), "ru");
  assert.equal(parseLang("AM"), "hy");
  assert.equal(parseLang("de"), "hy");
  assert.equal(parseLang(undefined), "hy");
  assert.equal(parseLang(undefined, "en"), "en");
  const r = validateOrderInput({ ...base, lang: "xx", show_on_stream: "yes" }, opt);
  assert.ok(r.ok && r.value.lang === "hy" && r.value.show_on_stream === false);
});

test("normalizeEmail", () => {
  assert.equal(normalizeEmail("a.b+c@example.co.uk"), "a.b+c@example.co.uk");
  assert.equal(normalizeEmail("a@b"), null);
  assert.equal(normalizeEmail("a@@b.am"), null);
  assert.equal(normalizeEmail("a..b@b.am"), null);
  assert.equal(normalizeEmail("a b@b.am"), null);
  assert.equal(normalizeEmail("a@-b.am"), null);
  assert.equal(normalizeEmail("x".repeat(65) + "@b.am"), null);
  assert.equal(normalizeEmail("a@xn--y9a3aq.xn--y9a3aq"), "a@xn--y9a3aq.xn--y9a3aq");
  assert.equal(normalizeEmail(null), null);
});

test("waitlist input", () => {
  const r = validateWaitlistInput({ email: "A@B.am", lang: "ru" });
  assert.ok(r.ok && r.value.email === "a@b.am" && r.value.lang === "ru");
  assert.equal(validateWaitlistInput({}).ok, false);
  const bad = validateWaitlistInput({ email: "bad" });
  assert.ok(!bad.ok && bad.code === "EMAIL_INVALID");
});
