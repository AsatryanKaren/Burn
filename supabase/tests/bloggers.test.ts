import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOGGER_LIMITS,
  checkProductAvailable,
  normalizeProfileLink,
  validateBloggerInput,
} from "../functions/_shared/validation.ts";
import { bloggersCsv, ADMIN_ACTIONS } from "../functions/_shared/admin.ts";
import { ApiError, errorBody } from "../functions/_shared/errors.ts";
import { errorResponse } from "../functions/_shared/http.ts";
import { giftShareAmd } from "../functions/_shared/money.ts";

const base = {
  name: "  Anna   Petrosyan ",
  link: " https://www.instagram.com/anna.p ",
  platform: "Instagram",
  audience: " 25k ",
  email: " Anna@Example.AM ",
  phone: " +374 91 123456 ",
  message: "I'd love\nto come\talong",
  lang: "en",
  consent: true,
};

type R = ReturnType<typeof validateBloggerInput>;
const err = (r: R) => (r.ok ? null : r.code);
const field = (r: R) => (r.ok ? null : r.field ?? null);

test("valid blogger application is normalized", () => {
  const r = validateBloggerInput(base);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, {
      name: "Anna Petrosyan",
      link: "https://www.instagram.com/anna.p",
      platform: "instagram",
      audience: "25k",
      email: "anna@example.am",
      phone: "+374 91 123456",
      message: "I'd love to come along",
      lang: "en",
    });
  }
});

test("optional fields may be missing, null or blank", () => {
  const r = validateBloggerInput({ name: "A", link: "https://t.me/a", email: "a@b.am", consent: true, platform: "", audience: null, phone: "  " });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.platform, null);
    assert.equal(r.value.audience, null);
    assert.equal(r.value.phone, null);
    assert.equal(r.value.message, null);
    assert.equal(r.value.lang, "hy");
  }
  const n = validateBloggerInput({ ...base, audience: 25000 });
  assert.ok(n.ok && n.value.audience === "25000");
});

test("body and consent", () => {
  assert.equal(err(validateBloggerInput(null)), "INVALID_JSON");
  assert.equal(err(validateBloggerInput([])), "INVALID_JSON");
  assert.equal(err(validateBloggerInput({ ...base, consent: "true" })), "CONSENT_REQUIRED");
  assert.equal(err(validateBloggerInput({ ...base, consent: undefined })), "CONSENT_REQUIRED");
});

test("required fields", () => {
  assert.equal(err(validateBloggerInput({ ...base, name: " ​ " })), "NAME_REQUIRED");
  assert.equal(err(validateBloggerInput({ ...base, name: 5 })), "NAME_REQUIRED");
  assert.equal(err(validateBloggerInput({ ...base, link: "" })), "LINK_REQUIRED");
  assert.equal(err(validateBloggerInput({ ...base, email: undefined })), "EMAIL_REQUIRED");
  assert.equal(err(validateBloggerInput({ ...base, email: "nope@" })), "EMAIL_INVALID");
});

test("link must be an http(s) URL", () => {
  for (const bad of ["javascript:alert(1)", "ftp://x.am/a", "mailto:a@b.am", "@anna", "anna", "https://localhost/x",
                     "https://user:pw@x.am", "http://", "https://x .am", "data:text/html,hi"]) {
    assert.equal(err(validateBloggerInput({ ...base, link: bad })), "LINK_INVALID", bad);
  }
  assert.equal(normalizeProfileLink("instagram.com/anna"), "https://instagram.com/anna");
  assert.equal(normalizeProfileLink("//youtube.com/@anna"), "https://youtube.com/@anna");
  assert.equal(normalizeProfileLink("http://tiktok.com/@anna"), "http://tiktok.com/@anna");
  assert.equal(normalizeProfileLink("HTTPS://T.ME/anna"), "HTTPS://T.ME/anna");
});

test("platform must be one of the list", () => {
  for (const p of ["instagram", "tiktok", "youtube", "facebook", "telegram", "other", " YouTube "]) {
    const r = validateBloggerInput({ ...base, platform: p });
    assert.ok(r.ok, p);
  }
  assert.equal(err(validateBloggerInput({ ...base, platform: "myspace" })), "PLATFORM_INVALID");
  assert.equal(err(validateBloggerInput({ ...base, platform: 3 })), "PLATFORM_INVALID");
});

test("phone format", () => {
  assert.ok(validateBloggerInput({ ...base, phone: "(091) 12-34-56" }).ok);
  assert.equal(err(validateBloggerInput({ ...base, phone: "call me" })), "PHONE_INVALID");
  assert.equal(err(validateBloggerInput({ ...base, phone: "+1" })), "PHONE_INVALID");
});

test("lengths -> TOO_LONG with field", () => {
  const cases: [string, unknown][] = [
    ["name", "ա".repeat(BLOGGER_LIMITS.name + 1)],
    ["link", "https://x.am/" + "a".repeat(BLOGGER_LIMITS.link)],
    ["audience", "1".repeat(BLOGGER_LIMITS.audience + 1)],
    ["email", "a".repeat(250) + "@b.am"],
    ["phone", "1".repeat(BLOGGER_LIMITS.phone + 1)],
    ["message", "m".repeat(BLOGGER_LIMITS.message + 1)],
  ];
  for (const [f, v] of cases) {
    const r = validateBloggerInput({ ...base, [f]: v });
    assert.equal(err(r), "TOO_LONG", f);
    assert.equal(field(r), f);
  }
  // Limits are inclusive, counted in code points after normalization.
  assert.ok(validateBloggerInput({ ...base, name: "ա".repeat(BLOGGER_LIMITS.name) }).ok);
  assert.ok(validateBloggerInput({ ...base, message: "🔥".repeat(BLOGGER_LIMITS.message) }).ok);
  assert.ok(validateBloggerInput({ ...base, message: "  " + "m ".repeat(250) }).ok); // 499 after trim
  // Scheme added to a 293-char bare link pushes it over 300.
  assert.equal(field(validateBloggerInput({ ...base, link: "x.am/" + "a".repeat(290) })), "link");
});

test("error body carries field only when set", async () => {
  assert.deepEqual(errorBody("TOO_LONG", "m", "name"), { error: { code: "TOO_LONG", message: "m", field: "name" } });
  assert.deepEqual(errorBody("EMAIL_INVALID", "m"), { error: { code: "EMAIL_INVALID", message: "m" } });
  const res = errorResponse(new ApiError(400, "TOO_LONG", "m", "message"));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: { code: "TOO_LONG", message: "m", field: "message" } });
});

test("bloggers_csv export", () => {
  assert.ok((ADMIN_ACTIONS as readonly string[]).includes("bloggers_csv"));
  const csv = bloggersCsv([
    {
      id: 1, created_at: "2026-10-27T10:00:00Z", status: "new", name: "Anna", link: "https://instagram.com/anna",
      platform: "instagram", audience: "25k", email: "a@b.am", phone: "+374 91 123456", message: 'Hi, "team"', lang: "hy",
    },
    {
      id: 2, created_at: "t", status: "contacted", name: "=HYPERLINK(\"x\")", link: "https://t.me/b",
      platform: null, audience: null, email: "c@d.am", phone: null, message: "-1 line", lang: "ru",
    },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "id,created_at,status,name,link,platform,audience,email,phone,message,lang");
  assert.equal(lines[1], `1,2026-10-27T10:00:00Z,new,Anna,https://instagram.com/anna,instagram,25k,a@b.am,"'+374 91 123456","Hi, ""team""",hy`);
  assert.equal(lines[2], `2,t,contacted,"'=HYPERLINK(""x"")",https://t.me/b,,,c@d.am,,"'-1 line",ru`);
  assert.equal(lines[3], "");
  assert.equal(bloggersCsv([]), "id,created_at,status,name,link,platform,audience,email,phone,message,lang\r\n");
});

test("only active products are sellable (create-order, start-payment)", () => {
  const r = checkProductAvailable({ code: "burn", price_amd: 500, active: true });
  assert.ok(r.ok && r.value.price_amd === 500);
  for (const code of ["burn_wish", "gift", "midnight", "light_big"]) {
    const x = checkProductAvailable({ code, price_amd: 1900, active: false });
    assert.equal(x.ok ? null : x.code, "PRODUCT_UNAVAILABLE", code);
  }
  const missing = checkProductAvailable(null);
  assert.equal(missing.ok ? null : missing.code, "PRODUCT_UNAVAILABLE");
});

test("one price: 500 AMD gives 100 AMD to the gift fund", () => {
  assert.equal(giftShareAmd(500), 100);
});
