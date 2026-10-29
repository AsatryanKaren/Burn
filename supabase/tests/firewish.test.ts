import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  burnWishDecision,
  FIRE_WISH_MAX,
  fireWishView,
  validateBurnWishInput,
} from "../functions/_shared/firewish.ts";
import {
  checkProductNotRetired,
  LIGHT_PRODUCT_CODES,
  PAPER_PRODUCT_CODES,
  RETIRED_PRODUCT_CODES,
  validateOrderInput,
} from "../functions/_shared/validation.ts";
import { ADMIN_ACTIONS, parseModerate } from "../functions/_shared/admin.ts";
import { moderate } from "../functions/_shared/moderation.ts";
import { ErrorCode } from "../functions/_shared/errors.ts";

const CODE = "k7m2abcdefgh2345";
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sql = read("../migrations/0013_fire_wish.sql");

function code(r: { ok: boolean; code?: string }): string | null {
  return r.ok ? null : r.code ?? null;
}

// ---------------------------------------------------------------------------
// validateBurnWishInput
// ---------------------------------------------------------------------------

test("burn-wish input: valid, defaults", () => {
  assert.deepEqual(validateBurnWishInput({ code: CODE, text: "  let the fear go \n away " }), {
    ok: true,
    value: { code: CODE, text: "let the fear go away", show_on_stream: true, lang: "hy" },
  });
  assert.deepEqual(validateBurnWishInput({ code: CODE, text: "x", show_on_stream: false, lang: "EN" }), {
    ok: true,
    value: { code: CODE, text: "x", show_on_stream: false, lang: "en" },
  });
  // only false turns show_on_stream off
  for (const v of [true, undefined, null, "false", 0]) {
    const r = validateBurnWishInput({ code: CODE, text: "x", show_on_stream: v });
    assert.ok(r.ok && r.value.show_on_stream === true, String(v));
  }
});

test("burn-wish input: code is normalized like other code inputs", () => {
  const r = validateBurnWishInput({ code: "  K7M2ABCDEFGH2345 ", text: "x" });
  assert.ok(r.ok && r.value.code === CODE);
  // Crockford look-alikes: o -> 0, i/l -> 1
  const r2 = validateBurnWishInput({ code: "o000000000000000", text: "x" });
  assert.ok(r2.ok && r2.value.code === "0000000000000000");
});

test("burn-wish input: CODE_INVALID", () => {
  for (const bad of [undefined, null, "", "short", "k7m2abcdefgh23456", "k7m2abcdefgh234u", 1234567890123456, ["x"]]) {
    assert.equal(code(validateBurnWishInput({ code: bad, text: "x" })), ErrorCode.CODE_INVALID, String(bad));
  }
});

test("burn-wish input: text rules as a paper (1..120 after normalization)", () => {
  for (const empty of [undefined, null, "", "   ", "​​", "\n\t", 5]) {
    assert.equal(code(validateBurnWishInput({ code: CODE, text: empty })), ErrorCode.TEXT_REQUIRED, JSON.stringify(empty));
  }
  assert.equal(FIRE_WISH_MAX, 120);
  assert.equal(code(validateBurnWishInput({ code: CODE, text: "a".repeat(120) })), null);
  assert.equal(code(validateBurnWishInput({ code: CODE, text: "a".repeat(121) })), ErrorCode.TEXT_TOO_LONG);
  // counted in code points, like Postgres char_length
  assert.equal(code(validateBurnWishInput({ code: CODE, text: "🔥".repeat(120) })), null);
  // whitespace collapses before counting
  assert.equal(code(validateBurnWishInput({ code: CODE, text: "a ".repeat(60) + "     " })), null);
});

test("burn-wish input: order of checks", () => {
  for (const bad of [null, [], "x", 3]) assert.equal(code(validateBurnWishInput(bad)), ErrorCode.INVALID_JSON);
  assert.equal(code(validateBurnWishInput({ code: "bad", text: "" })), ErrorCode.CODE_INVALID);
  assert.equal(code(validateBurnWishInput({})), ErrorCode.CODE_INVALID);
});

test("burn-wish: moderation is the paper moderation", () => {
  assert.equal(moderate({ text: "call me +374 91 123456" }).decision, "hidden");
  assert.equal(moderate({ text: "goodbye to the old fears" }).decision, "pending");
});

// ---------------------------------------------------------------------------
// burnWishDecision
// ---------------------------------------------------------------------------

test("burn_wish answers -> HTTP", () => {
  assert.deepEqual(burnWishDecision({ ok: true, already: false, burn_number: 42 }), {
    ok: true,
    body: { ok: true, burn_number: 42, already: false },
  });
  assert.deepEqual(burnWishDecision({ ok: true, already: true, burn_number: 7, extra: 1 }), {
    ok: true,
    body: { ok: true, burn_number: 7, already: true },
  });
  const expect: [string, number, string][] = [
    ["ORDER_NOT_FOUND", 404, ErrorCode.ORDER_NOT_FOUND],
    ["ORDER_NOT_LIGHT", 409, ErrorCode.ORDER_NOT_LIGHT],
    ["ORDER_NOT_PAID", 409, ErrorCode.ORDER_NOT_PAID],
  ];
  for (const [err, status, c] of expect) {
    const d = burnWishDecision({ ok: false, error: err });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.status, status);
      assert.equal(d.code, c);
    }
  }
});

test("burn_wish unexpected answers -> 500", () => {
  for (const bad of [
    null, [], "ok", {}, { ok: false }, { ok: false, error: "INVALID_ARGS" }, { ok: false, error: "toString" },
    { ok: true, burn_number: "1", already: false }, { ok: true, burn_number: 0, already: false },
    { ok: true, burn_number: 1.5, already: false }, { ok: true, burn_number: 1 },
  ]) {
    const d = burnWishDecision(bad);
    assert.equal(d.ok, false, JSON.stringify(bad));
    if (!d.ok) assert.equal(d.status, 500);
  }
});

test("order-status fire view", () => {
  assert.equal(fireWishView(null), null);
  assert.equal(fireWishView(undefined), null);
  const row = { burn_number: 9, text: "t", show_on_stream: false, created_at: "2026-12-31T20:00:00Z", moderation: "pending" };
  assert.deepEqual(fireWishView(row), { burn_number: 9, text: "t", show_on_stream: false, created_at: "2026-12-31T20:00:00Z" });
});

// ---------------------------------------------------------------------------
// create-order: papers retired
// ---------------------------------------------------------------------------

test("create-order: every paper product is retired, lights are not", () => {
  assert.deepEqual(RETIRED_PRODUCT_CODES, PAPER_PRODUCT_CODES);
  for (const p of PAPER_PRODUCT_CODES) {
    const r = checkProductNotRetired({ product: p, text: "x", consent: true });
    assert.equal(code(r), ErrorCode.PRODUCT_RETIRED, p);
  }
  // retired wins over field errors (checked before validateOrderInput)
  assert.equal(code(checkProductNotRetired({ product: "burn" })), ErrorCode.PRODUCT_RETIRED);
  for (const p of LIGHT_PRODUCT_CODES) assert.equal(code(checkProductNotRetired({ product: p })), null, p);
  for (const other of [null, [], "x", {}, { product: "nope" }, { product: 1 }]) {
    assert.equal(code(checkProductNotRetired(other)), null, JSON.stringify(other));
  }
  // validateOrderInput itself is unchanged (existing paper paths keep their types)
  assert.ok(validateOrderInput({ product: "burn", text: "x", consent: true }, { emailRequired: false }).ok);
});

test("create-order calls the retired check before validation", () => {
  const src = read("../functions/create-order/index.ts");
  const i = src.indexOf("checkProductNotRetired(body)");
  const j = src.indexOf("validateOrderInput(body");
  assert.ok(i > 0 && j > i);
  assert.match(src, /new ApiError\(400, retired\.code/);
});

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

test("admin: moderate_wish action with the moderate params", () => {
  assert.ok((ADMIN_ACTIONS as readonly string[]).includes("moderate_wish"));
  assert.ok(parseModerate({ code: CODE, moderation: "approved" }).ok);
  const src = read("../functions/admin/index.ts");
  assert.match(src, /case "moderate_wish":[\s\S]*?rpc<[^>]*>\("admin_moderate_wish"/);
});

// ---------------------------------------------------------------------------
// Wiring: burn-wish function, config.toml, rate limits
// ---------------------------------------------------------------------------

test("config.toml: burn-wish has verify_jwt = false", () => {
  assert.match(read("../config.toml"), /\[functions\.burn-wish\]\s*\nverify_jwt = false/);
});

test("burn-wish: limits per IP and per code, rate limit after validation, moderation before the RPC", () => {
  const rl = read("../functions/_shared/ratelimit.ts");
  assert.match(rl, /burnWish:\s*\{\s*limit:\s*20,\s*windowSeconds:\s*3600\s*\}/);
  assert.match(rl, /burnWishCode:\s*\{\s*limit:\s*10,\s*windowSeconds:\s*3600\s*\}/);
  const src = read("../functions/burn-wish/index.ts");
  const order = [
    "validateBurnWishInput(body)",
    'enforceRateLimit("burnWish", ipHash)',
    'enforceRateLimit("burnWishCode", input.code)',
    "moderate({ text: input.text })",
    "ErrorCode.TEXT_REJECTED",
    "await burnWish(",
    "burnWishDecision(rpc)",
  ].map((s) => src.indexOf(s));
  assert.ok(order.every((n) => n > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(src, /browserEndpoint\(\["POST"\], cfg\.cors/);
  assert.match(src, /initialModeration\(mod, cfg\.autoApprove\)/);
});

test("order-status: fire only for light orders", () => {
  const src = read("../functions/order-status/index.ts");
  const light = src.indexOf("const lightFields = light");
  const fire = src.indexOf("fire: fireWishView(await getFireWish(order.id))");
  const other = src.indexOf(": {};", light);
  assert.ok(light > 0 && fire > light && other > fire);
});

// ---------------------------------------------------------------------------
// Migration 0013
// ---------------------------------------------------------------------------

test("0013: fire_wishes table shape, RLS and grants", () => {
  assert.match(sql, /order_id\s+bigint\s+primary key references public\.orders\(id\)/);
  assert.match(sql, /burn_number\s+integer\s+not null unique default nextval\('public\.burn_number_seq'\)/);
  assert.match(sql, /show_on_stream\s+boolean\s+not null default true/);
  assert.match(sql, /check \(char_length\(text\) between 1 and 120\)/);
  assert.match(sql, /check \(moderation in \('pending', 'approved', 'hidden', 'rejected'\)\)/);
  assert.match(sql, /moderation\s+text\s+not null default 'pending'/);
  assert.match(sql, /alter table public\.fire_wishes enable row level security;/);
  assert.match(sql, /revoke all on table public\.fire_wishes from public, anon, authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.fire_wishes to service_role;/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /grant [^;]* on (table )?public\.fire_wishes to [^;]*(anon|authenticated)/);
});

test("0013: service_role-only functions", () => {
  for (const fn of ["burn_wish(text, text, boolean, text, text, text)", "admin_moderate_wish(text, text, text)", "admin_list_orders(text, text, text, integer, bigint)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.ok(sql.includes("revoke all on function public.fire_wish_renumber_on_paid() from public, anon, authenticated;"));
  for (const fn of ["burn_wish", "admin_moderate_wish", "fire_wish_renumber_on_paid"]) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, 600), /security definer\s+set search_path = public/, fn);
  }
});

test("0013: burn_wish rules", () => {
  const body = sql.slice(sql.indexOf("create function public.burn_wish("), sql.indexOf("revoke all on function public.burn_wish"));
  assert.match(body, /from public\.orders where code = p_code for update/);
  assert.match(body, /product not in \('light', 'light_big'\)[\s\S]*'ORDER_NOT_LIGHT'/);
  assert.match(body, /status not in \('paid', 'awaiting_launch'\)[\s\S]*'ORDER_NOT_PAID'/);
  assert.match(body, /'ORDER_NOT_FOUND'/);
  assert.match(body, /'already', true, 'burn_number', v_number/);
  assert.match(body, /'already', false, 'burn_number', v_number/);
  // lock comes before the existence check
  assert.ok(body.indexOf("for update") < body.indexOf("from public.fire_wishes w where w.order_id"));
});

test("0013: public RPCs keep their contract", () => {
  assert.match(sql, /grant execute on function public\.get_public_stats\(\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.get_fire_feed\(integer, integer\) to anon, authenticated, service_role;/);
  assert.match(sql, /get_fire_feed\(after_number integer default 0, max_rows integer default 50\)\s+returns table \(burn_number integer, text_public text, paid_at timestamptz, product text\)/);
  assert.match(sql, /limit least\(greatest\(coalesce\(max_rows, 50\), 1\), 100\);/);
  assert.match(sql, /case when w\.show_on_stream and w\.moderation = 'approved' then w\.text end/);
  assert.match(sql, /'wish'::text as product/);
  const stats = sql.slice(sql.indexOf("create or replace function public.get_public_stats()"));
  for (const key of ["papers_burned", "gift_fund_amd", "wishes_kept", "waitlist_count", "lights_lit", "updated_at"]) {
    assert.ok(stats.includes(`'${key}',`), key);
  }
});

test("0013: wishes saved before payment are renumbered when paid", () => {
  assert.match(sql, /after update of status on public\.orders/);
  assert.match(sql, /when \(new\.status = 'paid' and old\.status is distinct from 'paid' and new\.product in \('light', 'light_big'\)\)/);
  assert.match(sql, /set burn_number = nextval\('public\.burn_number_seq'\)/);
});

test("0013: admin_list_orders keeps every 0005 column and adds the wish", () => {
  const prev = read("../migrations/0005_lights.sql");
  const cols = (s: string) => {
    const a = s.indexOf("create or replace function public.admin_list_orders(");
    const sel = s.slice(s.indexOf("select o.id", a), s.indexOf("from public.orders o", a));
    return [...sel.matchAll(/o\.(\w+)/g)].map((m) => m[1]);
  };
  const before = cols(prev);
  const after = cols(sql);
  assert.ok(before.length > 10);
  for (const c of before) assert.ok(after.includes(c), c);
  for (const k of ["fire_text", "fire_moderation", "fire_burn_number"]) assert.ok(sql.includes(`as ${k}`), k);
});
