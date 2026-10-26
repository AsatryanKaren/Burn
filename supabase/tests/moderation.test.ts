import { test } from "node:test";
import assert from "node:assert/strict";
import { detectContact, findBlockedWord, findName, foldToken, initialModeration, moderate } from "../functions/_shared/moderation.ts";

const decision = (text: string, extra: { wish_text?: string; recipient_name?: string } = {}) =>
  moderate({ text, ...extra }).decision;

test("folding", () => {
  assert.equal(foldToken("F.U.C.K"), "fuck");
  assert.equal(foldToken("Ёлка"), "елка");
  assert.equal(foldToken("cукa"), "сука"); // Latin c/a inside a Cyrillic word
  assert.equal(foldToken("Լևոն"), "լեվոն");
  assert.equal(foldToken("$uka"), "suka");
});

test("rejects strong profanity in English", () => {
  for (const t of ["fuck 2026", "F*U*C*K this", "fuuuuck", "motherfucker", "you cunt", "f*ck it"]) {
    assert.equal(decision(t), "rejected", t);
  }
});

test("rejects strong profanity in Russian (Cyrillic and Latin)", () => {
  for (const t of ["сука", "Блять", "иди нахуй", "пиздец", "заебал этот год", "ёбаный год", "cука", "suka", "blyat"]) {
    assert.equal(decision(t), "rejected", t);
  }
});

test("rejects strong profanity in Armenian (script, Latin, Cyrillic)", () => {
  for (const t of ["քունեմ", "Kunem", "qunem qu", "բոզ", "сиктир", "siktir", "pesevenk"]) {
    assert.equal(decision(t), "rejected", t);
  }
});

test("rejects slurs", () => {
  for (const t of ["хачи", "жид", "nigger", "faggot"]) assert.equal(decision(t), "rejected", t);
});

test("checks wish and recipient fields too", () => {
  assert.equal(decision("fine", { wish_text: "сука" }), "rejected");
  assert.equal(decision("fine", { recipient_name: "cunt" }), "rejected");
});

test("does not reject ordinary words that contain blocked fragments", () => {
  for (
    const t of [
      "хлебать", "страхуйся", "оскорблять", "педикюр", "хачапури", "sukiyaki",
      "Scunthorpe", "Niger and Nigeria", "Գյոթե", "բոզբաշ", "քուն չունեմ", "shit year", "damn", "черт",
      "Թող մնա 2026-ում բոլոր վախերը", "retardant",
    ]
  ) {
    assert.notEqual(decision(t), "rejected", t);
  }
});

test("hides contact data", () => {
  assert.equal(detectContact("call 093 12 34 56"), "phone");
  assert.equal(detectContact("+374 93 123456"), "phone");
  assert.equal(detectContact("8 (915) 123-45-67"), "phone");
  assert.equal(detectContact("write me a@b.am"), "email");
  assert.equal(detectContact("see https://x.y"), "url");
  assert.equal(detectContact("www.example"), "url");
  assert.equal(detectContact("site.am is bad"), "url");
  assert.equal(detectContact("ok.ru"), "url");
  assert.equal(detectContact("t.me/someone"), "url");
  assert.equal(detectContact("follow @karen_a"), "handle");
  for (const t of ["from 2025 to 2026", "31.12.2026", "debt of 10 000 000", "I am tired", "end. Am I", "12:00", "500 AMD"]) {
    assert.equal(detectContact(t), null, t);
  }
  assert.equal(decision("call me 093123456"), "hidden");
  assert.equal(moderate({ text: "call me 093123456" }).reason, "auto:phone");
});

test("hides common Armenian first names in three scripts with endings", () => {
  for (const t of ["Արամ", "Արամին", "Արամյան", "Aram", "Arami", "Арам", "Арамян", "Анну", "Gevorg", "Կարենը", "Լևոնի"]) {
    assert.ok(findName(t), t);
  }
  assert.equal(moderate({ text: "my ex Tigran" }).reason, "auto:name");
});

test("name check does not hide ordinary words", () => {
  for (const t of ["седой", "седина", "гора", "горе", "грант", "marine corps", "arsenal", "Armenia", "Հայաստան", "sun", "hope", "Армения"]) {
    assert.equal(findName(t), null, t);
  }
});

test("names in the private recipient field are fine", () => {
  assert.equal(moderate({ text: "loneliness", recipient_name: "Aram" }).decision, "pending");
});

test("everything else is pending", () => {
  assert.deepEqual(moderate({ text: "fear of the dark" }), { decision: "pending", reason: null });
  assert.equal(findBlockedWord("calm year"), null);
});

test("auto-approval applies only to clean texts", () => {
  assert.equal(initialModeration(moderate({ text: "fear" }), true), "approved");
  assert.equal(initialModeration(moderate({ text: "fear" }), false), "pending");
  assert.equal(initialModeration(moderate({ text: "Aram" }), true), "hidden");
  assert.equal(initialModeration(moderate({ text: "a@b.am" }), true), "hidden");
});
