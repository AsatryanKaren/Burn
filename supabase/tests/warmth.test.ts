import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rateLimitedDecision,
  ROOM_ACTIONS,
  validateWarmthInput,
  warmthDecision,
  warmthLimitName,
} from "../functions/_shared/warmth.ts";
import { CELL_ID_MAX } from "../functions/_shared/validation.ts";
import { ApiError, ErrorCode } from "../functions/_shared/errors.ts";
import { errorResponse } from "../functions/_shared/http.ts";

function code(r: ReturnType<typeof validateWarmthInput>): string | null {
  return r.ok ? null : r.code;
}

// ---------------------------------------------------------------------------
// validateWarmthInput
// ---------------------------------------------------------------------------

test("warmth input: valid warm and visit", () => {
  assert.deepEqual(validateWarmthInput({ cell_id: 4321, action: "warm" }), {
    ok: true,
    value: { cell_id: 4321, action: "warm" },
  });
  assert.deepEqual(validateWarmthInput({ cell_id: 0, action: "visit" }), {
    ok: true,
    value: { cell_id: 0, action: "visit" },
  });
  assert.deepEqual(ROOM_ACTIONS, ["warm", "visit"]);
});

test("warmth input: cell_id bounds and string digits (as create-order)", () => {
  assert.equal(code(validateWarmthInput({ cell_id: CELL_ID_MAX, action: "warm" })), null);
  assert.deepEqual(validateWarmthInput({ cell_id: " 66 ", action: "visit" }), {
    ok: true,
    value: { cell_id: 66, action: "visit" },
  });
  for (const bad of [CELL_ID_MAX + 1, -1, 1.5, NaN, Infinity, "1e3", "-1", "", "abc", null, undefined, true, [1], { id: 1 }]) {
    assert.equal(code(validateWarmthInput({ cell_id: bad, action: "warm" })), ErrorCode.CELL_INVALID, String(bad));
  }
});

test("warmth input: action must be exactly warm or visit", () => {
  for (const bad of ["WARM", " warm", "like", "", null, undefined, 1, ["warm"]]) {
    assert.equal(code(validateWarmthInput({ cell_id: 1, action: bad })), ErrorCode.ACTION_INVALID, String(bad));
  }
});

test("warmth input: body must be an object; cell is checked before action", () => {
  for (const bad of [null, [], "x", 3, true]) {
    assert.equal(code(validateWarmthInput(bad)), ErrorCode.INVALID_JSON);
  }
  assert.equal(code(validateWarmthInput({ cell_id: -1, action: "nope" })), ErrorCode.CELL_INVALID);
  assert.equal(code(validateWarmthInput({})), ErrorCode.CELL_INVALID);
});

test("warmth input: extra keys are ignored", () => {
  assert.equal(code(validateWarmthInput({ cell_id: 5, action: "warm", ip_hash: "x", count: 100 })), null);
});

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

test("warmth limits: names per action", () => {
  assert.equal(warmthLimitName("warm"), "roomWarm");
  assert.equal(warmthLimitName("visit"), "roomVisit");
});

test("warmth limits: values (30/hour warm, 300/hour visit)", async (t) => {
  // ratelimit.ts imports db.ts (npm: specifier), so read the table from source.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../functions/_shared/ratelimit.ts", import.meta.url), "utf8");
  assert.match(src, /roomWarm:\s*\{\s*limit:\s*30,\s*windowSeconds:\s*3600\s*\}/);
  assert.match(src, /roomVisit:\s*\{\s*limit:\s*300,\s*windowSeconds:\s*3600\s*\}/);
  t.diagnostic("limits read from ratelimit.ts");
});

test("rate-limited visit answers ok without counts; warm answers 429", () => {
  assert.deepEqual(rateLimitedDecision("visit"), { ok: true, body: { ok: true } });
  const d = rateLimitedDecision("warm");
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.status, 429);
    assert.equal(d.code, ErrorCode.RATE_LIMITED);
    const res = errorResponse(new ApiError(d.status, d.code, d.message));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "600");
  }
});

// ---------------------------------------------------------------------------
// warmthDecision: RPC answer -> HTTP answer
// ---------------------------------------------------------------------------

test("warm: first and repeated warmth", () => {
  assert.deepEqual(warmthDecision("warm", { ok: true, warmth: 1, already: false }), {
    ok: true,
    body: { ok: true, warmth: 1, already: false },
  });
  assert.deepEqual(warmthDecision("warm", { ok: true, warmth: 7, already: true }), {
    ok: true,
    body: { ok: true, warmth: 7, already: true },
  });
});

test("visit: count", () => {
  assert.deepEqual(warmthDecision("visit", { ok: true, visits: 12 }), { ok: true, body: { ok: true, visits: 12 } });
  // a visit answer never carries warmth, even if the RPC sent extra fields
  assert.deepEqual(warmthDecision("visit", { ok: true, visits: 3, warmth: 9 }), {
    ok: true,
    body: { ok: true, visits: 3 },
  });
});

test("unlit plot -> 404 NOT_LIT for both actions", () => {
  for (const action of ROOM_ACTIONS) {
    const d = warmthDecision(action, { ok: false, error: "NOT_LIT" });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.status, 404);
      assert.equal(d.code, ErrorCode.NOT_LIT);
    }
  }
});

test("unexpected RPC answers -> 500 INTERNAL", () => {
  const bad: [("warm" | "visit"), unknown][] = [
    ["warm", null],
    ["warm", []],
    ["warm", "ok"],
    ["warm", { ok: false, error: "INVALID_ARGS" }],
    ["warm", { ok: true, warmth: "1", already: false }],
    ["warm", { ok: true, warmth: -1, already: false }],
    ["warm", { ok: true, warmth: 1 }],
    ["warm", { ok: true, visits: 1 }],
    ["visit", { ok: true, warmth: 1, already: false }],
    ["visit", { ok: true, visits: 1.5 }],
    ["visit", { ok: false }],
  ];
  for (const [action, rpc] of bad) {
    const d = warmthDecision(action, rpc);
    assert.equal(d.ok, false, JSON.stringify(rpc));
    if (!d.ok) {
      assert.equal(d.status, 500);
      assert.equal(d.code, ErrorCode.INTERNAL);
    }
  }
});

// ---------------------------------------------------------------------------
// Wiring: config.toml and the function source
// ---------------------------------------------------------------------------

test("config.toml: room-warmth has verify_jwt = false", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.room-warmth\]\s*\nverify_jwt = false/);
});

test("migration 0011: functions are service_role only, get_cell/get_map stay public", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../migrations/0011_room_warmth.sql", import.meta.url), "utf8");
  for (const fn of ["room_add_warmth(integer, text)", "room_add_visit(integer)", "room_stats_prepare(integer)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn}`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")}\\s+to service_role;`), fn);
  }
  assert.doesNotMatch(sql, /grant [^;]* on (table )?public\.room_(stats|warmth_log) to (anon|authenticated)/);
  assert.match(sql, /grant execute on function public\.get_cell\(integer\) to anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.get_map\(\)\s+to anon, authenticated, service_role;/);
  // get_cell keeps everything 0010 returned
  for (const key of ["cell_id", "province", "town_index", "status", "icon", "color", "big", "message", "signature", "lit_at", "room", "warmth", "visits"]) {
    assert.ok(sql.includes(`'${key}',`), key);
  }
  // get_map keeps everything 0005 returned
  for (const key of ["lit", "held", "total", "lit_count", "by_province", "warm", "updated_at"]) {
    assert.ok(sql.includes(`'${key}',`), key);
  }
});
