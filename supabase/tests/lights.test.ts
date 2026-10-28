import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLightProduct,
  LIGHT_COLORS,
  LIGHT_ICONS,
  parseCellId,
  validateOrderInput,
} from "../functions/_shared/validation.ts";
import { initialModeration, moderate } from "../functions/_shared/moderation.ts";

const base = {
  product: "light",
  cell_id: 4321,
  text: "peace for Gyumri",
  light_icon: "pomegranate",
  light_color: "amber",
  consent: true,
  lang: "hy",
};
const opt = { emailRequired: false };

function errCode(r: ReturnType<typeof validateOrderInput>): string | null {
  return r.ok ? null : r.code;
}

test("light product codes", () => {
  assert.ok(isLightProduct("light"));
  assert.ok(isLightProduct("light_big"));
  assert.ok(!isLightProduct("burn"));
  assert.ok(!isLightProduct(undefined));
});

test("icon and colour lists keep the contract order (get_map indexes)", () => {
  assert.deepEqual(LIGHT_ICONS, ["tree", "home", "candle", "star", "gift", "pomegranate"]);
  assert.deepEqual(LIGHT_COLORS, ["amber", "red", "green", "white", "blue", "violet"]);
});

test("valid light order", () => {
  const r = validateOrderInput({ ...base, light_signature: "  Anna  ", show_on_stream: true }, opt);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, {
      product: "light",
      text: "peace for Gyumri",
      cell_id: 4321,
      light_icon: "pomegranate",
      light_color: "amber",
      light_signature: "Anna",
      room: null,
      email: null,
      lang: "hy",
    });
  }
  const big = validateOrderInput({ ...base, product: "light_big", cell_id: "0", light_signature: "" }, opt);
  assert.ok(big.ok && big.value.product === "light_big");
  assert.ok(big.ok && "cell_id" in big.value && big.value.cell_id === 0 && big.value.light_signature === null);
});

test("light message is 1..60", () => {
  assert.equal(errCode(validateOrderInput({ ...base, text: " " }, opt)), "TEXT_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, text: "ա".repeat(61) }, opt)), "TEXT_TOO_LONG");
  assert.ok(validateOrderInput({ ...base, text: "ա".repeat(60) }, opt).ok);
});

test("cell id", () => {
  assert.equal(parseCellId(12), 12);
  assert.equal(parseCellId(" 17 "), 17);
  for (const bad of [-1, 1.5, "1e3", "", null, undefined, {}, NaN, 1_000_000, "abc"]) {
    assert.equal(parseCellId(bad), null, String(bad));
  }
  assert.equal(errCode(validateOrderInput({ ...base, cell_id: undefined }, opt)), "CELL_INVALID");
  assert.equal(errCode(validateOrderInput({ ...base, cell_id: -5 }, opt)), "CELL_INVALID");
});

test("icon, colour and signature", () => {
  assert.equal(errCode(validateOrderInput({ ...base, light_icon: "skull" }, opt)), "ICON_INVALID");
  assert.equal(errCode(validateOrderInput({ ...base, light_icon: undefined }, opt)), "ICON_INVALID");
  assert.equal(errCode(validateOrderInput({ ...base, light_color: "black" }, opt)), "COLOR_INVALID");
  assert.equal(errCode(validateOrderInput({ ...base, light_signature: "x".repeat(31) }, opt)), "SIGNATURE_TOO_LONG");
  assert.ok(validateOrderInput({ ...base, light_signature: "x".repeat(30) }, opt).ok);
  assert.ok(validateOrderInput({ ...base, light_icon: " Star ", light_color: "BLUE" }, opt).ok);
});

test("lights take no wish or recipient; email rules as for papers", () => {
  assert.equal(errCode(validateOrderInput({ ...base, wish_text: "x" }, opt)), "WISH_NOT_ALLOWED");
  assert.equal(errCode(validateOrderInput({ ...base, recipient_name: "x" }, opt)), "RECIPIENT_NOT_ALLOWED");
  assert.equal(errCode(validateOrderInput(base, { emailRequired: true })), "EMAIL_REQUIRED");
  assert.equal(errCode(validateOrderInput({ ...base, email: "bad" }, opt)), "EMAIL_INVALID");
  assert.equal(errCode(validateOrderInput({ ...base, consent: false }, opt)), "CONSENT_REQUIRED");
});

test("paper rules unchanged: light fields are ignored for papers", () => {
  const r = validateOrderInput({ product: "burn", text: "x".repeat(120), consent: true, cell_id: 5 }, opt);
  assert.ok(r.ok && !("cell_id" in r.value));
});

test("signature moderation: insults reject, contacts hide, names are fine", () => {
  const sig = (s: string) => moderate({ text: "light for all", light_signature: s });
  assert.deepEqual(sig("Aram"), { decision: "pending", reason: null });
  assert.equal(sig("Արամյան ընտանիք").decision, "pending");
  assert.equal(sig("Анна").decision, "pending");
  const bad = sig("сука");
  assert.equal(bad.decision, "rejected");
  assert.equal(bad.field, "signature");
  assert.equal(sig("093 12 34 56").decision, "hidden");
  assert.equal(sig("093 12 34 56").reason, "auto:signature_phone");
  assert.equal(sig("@aram_a").decision, "hidden");
  assert.equal(sig("aram.am").decision, "hidden");
});

test("light message moderation is the same as papers", () => {
  assert.equal(moderate({ text: "fuck 2026", light_signature: "Aram" }).field, undefined);
  assert.equal(moderate({ text: "fuck 2026", light_signature: "Aram" }).decision, "rejected");
  assert.equal(moderate({ text: "for Tigran", light_signature: null }).reason, "auto:name");
  assert.equal(initialModeration(moderate({ text: "light", light_signature: "Karen" }), true), "approved");
});
