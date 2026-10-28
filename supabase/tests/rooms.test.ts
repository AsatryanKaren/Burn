import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkRoomEditable,
  ROOM_EDITABLE_STATUSES,
  ROOM_FLOORS,
  ROOM_ITEM_TYPES,
  ROOM_MAX_BYTES,
  ROOM_MAX_ITEMS,
  ROOM_WALLS,
  validateOrderInput,
  validateRoom,
} from "../functions/_shared/validation.ts";

const room = () => ({
  v: 1,
  wall: "cream",
  floor: "oak",
  glow: true,
  items: [["tree", 0, 0, 0], ["sofa", 3, 5, 2], ["cat", 7, 7, 3]],
});

function code(r: ReturnType<typeof validateRoom>): string | null {
  return r.ok ? null : r.code;
}

const lightBase = {
  product: "light",
  cell_id: 4321,
  text: "peace for Gyumri",
  light_icon: "pomegranate",
  light_color: "amber",
  consent: true,
  lang: "hy",
};
const opt = { emailRequired: false };

// ---------------------------------------------------------------------------
// validateRoom: valid layouts
// ---------------------------------------------------------------------------

test("contract lists", () => {
  assert.deepEqual(ROOM_WALLS, ["cream", "sage", "night", "berry"]);
  assert.deepEqual(ROOM_FLOORS, ["oak", "walnut", "tile"]);
  assert.equal(ROOM_ITEM_TYPES.length, 20);
  assert.equal(ROOM_MAX_ITEMS, 40);
  assert.equal(ROOM_MAX_BYTES, 4096);
});

test("valid room is returned as a canonical copy, item order preserved", () => {
  const input = { items: room().items, glow: false, floor: "tile", wall: "berry", v: 1 };
  const r = validateRoom(input);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value, { v: 1, wall: "berry", floor: "tile", glow: false, items: room().items });
  assert.deepEqual(Object.keys(r.value), ["v", "wall", "floor", "glow", "items"]);
  assert.notEqual(r.value.items, input.items);
  assert.notEqual(r.value.items[0], input.items[0]);
});

test("empty room, every wall/floor/type, all range edges", () => {
  assert.ok(validateRoom({ ...room(), items: [] }).ok);
  for (const wall of ROOM_WALLS) assert.ok(validateRoom({ ...room(), wall }).ok, wall);
  for (const floor of ROOM_FLOORS) assert.ok(validateRoom({ ...room(), floor }).ok, floor);
  const all = ROOM_ITEM_TYPES.map((t, i) => [t, i % 8, 7 - (i % 8), i % 4]);
  const r = validateRoom({ ...room(), items: all });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value.items, all);
  assert.ok(validateRoom({ ...room(), items: [["rug", 0, 7, 0], ["rug", 7, 0, 3]] }).ok);
  // Overlap is the browser's business: the same cell twice is fine here.
  assert.ok(validateRoom({ ...room(), items: [["tv", 2, 2, 0], ["tv", 2, 2, 0]] }).ok);
});

test("-0 is accepted and stored as 0", () => {
  const r = validateRoom({ ...room(), items: [["lamp", -0, -0, -0]] });
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(Object.is(r.value.items[0][1], 0));
    assert.equal(JSON.stringify(r.value.items), '[["lamp",0,0,0]]');
  }
});

test("40 items of the longest type fit in the size limit", () => {
  const items = Array.from({ length: 40 }, () => ["pomegranates", 7, 7, 3]);
  const r = validateRoom({ v: 1, wall: "berry", floor: "walnut", glow: false, items });
  assert.ok(r.ok);
  if (r.ok) assert.ok(new TextEncoder().encode(JSON.stringify(r.value)).length <= ROOM_MAX_BYTES);
});

// ---------------------------------------------------------------------------
// validateRoom: invalid input -> ROOM_INVALID
// ---------------------------------------------------------------------------

test("not an object", () => {
  for (const v of [undefined, null, 1, "room", true, [], [room()], new Date(0)]) {
    assert.equal(code(validateRoom(v)), "ROOM_INVALID", String(v));
  }
});

test("keys: missing, extra, prototype tricks", () => {
  for (const k of ["v", "wall", "floor", "glow", "items"]) {
    const r = room() as Record<string, unknown>;
    delete r[k];
    assert.equal(code(validateRoom(r)), "ROOM_INVALID", `missing ${k}`);
  }
  assert.equal(code(validateRoom({ ...room(), extra: 1 })), "ROOM_INVALID");
  assert.equal(code(validateRoom({ ...room(), name: "Anna" })), "ROOM_INVALID");
  assert.equal(code(validateRoom(JSON.parse('{"v":1,"wall":"cream","floor":"oak","glow":true,"items":[],"__proto__":{}}'))), "ROOM_INVALID");
  class Fake {
    v = 1; wall = "cream"; floor = "oak"; glow = true; items = [];
  }
  assert.equal(code(validateRoom(new Fake())), "ROOM_INVALID");
});

test("v must be exactly the number 1", () => {
  for (const v of [0, 2, "1", 1.5, null, true]) {
    assert.equal(code(validateRoom({ ...room(), v })), "ROOM_INVALID", String(v));
  }
});

test("wall / floor from the lists only (case-sensitive, no trimming)", () => {
  for (const wall of ["Cream", " cream", "white", "", null, 0, ["cream"]]) {
    assert.equal(code(validateRoom({ ...room(), wall })), "ROOM_INVALID", String(wall));
  }
  for (const floor of ["OAK", "oak ", "marble", "", null, 1]) {
    assert.equal(code(validateRoom({ ...room(), floor })), "ROOM_INVALID", String(floor));
  }
});

test("glow must be a boolean", () => {
  for (const glow of [0, 1, "true", null, undefined]) {
    assert.equal(code(validateRoom({ ...room(), glow })), "ROOM_INVALID", String(glow));
  }
});

test("items must be an array of at most 40", () => {
  for (const items of [null, {}, "[]", 0]) {
    assert.equal(code(validateRoom({ ...room(), items })), "ROOM_INVALID", String(items));
  }
  const many = Array.from({ length: 41 }, () => ["cat", 0, 0, 0]);
  assert.equal(code(validateRoom({ ...room(), items: many })), "ROOM_INVALID");
  assert.ok(validateRoom({ ...room(), items: many.slice(0, 40) }).ok);
});

test("item shape: exactly [type, x, z, r]", () => {
  for (const it of [
    ["cat", 0, 0],
    ["cat", 0, 0, 0, 0],
    [],
    { type: "cat", x: 0, z: 0, r: 0 },
    "cat",
    null,
  ]) {
    assert.equal(code(validateRoom({ ...room(), items: [it] })), "ROOM_INVALID", JSON.stringify(it));
  }
});

test("item type from the list only", () => {
  for (const t of ["Cat", "dragon", "", " tree", null, 3, ["tree"]]) {
    assert.equal(code(validateRoom({ ...room(), items: [[t, 0, 0, 0]] })), "ROOM_INVALID", String(t));
  }
});

test("x, z integers 0..7; r integer 0..3", () => {
  const bad = [-1, 8, 1.5, NaN, Infinity, "1", null, true];
  for (const n of bad) {
    assert.equal(code(validateRoom({ ...room(), items: [["cat", n, 0, 0]] })), "ROOM_INVALID", `x=${n}`);
    assert.equal(code(validateRoom({ ...room(), items: [["cat", 0, n, 0]] })), "ROOM_INVALID", `z=${n}`);
    assert.equal(code(validateRoom({ ...room(), items: [["cat", 0, 0, n]] })), "ROOM_INVALID", `r=${n}`);
  }
  assert.equal(code(validateRoom({ ...room(), items: [["cat", 0, 0, 4]] })), "ROOM_INVALID");
  assert.ok(validateRoom({ ...room(), items: [["cat", 7, 7, 3]] }).ok);
});

test("one bad item anywhere rejects the whole room", () => {
  const items = Array.from({ length: 39 }, () => ["cat", 0, 0, 0]);
  items.push(["cat", 0, 0, 9]);
  assert.equal(code(validateRoom({ ...room(), items })), "ROOM_INVALID");
});

test("size limit: over 4096 bytes of JSON is rejected before anything else", () => {
  const big = { ...room(), pad: "x".repeat(ROOM_MAX_BYTES) };
  const r = validateRoom(big);
  assert.equal(code(r), "ROOM_INVALID");
  if (!r.ok) assert.match(r.message, /4096 bytes/);
  // Multi-byte characters count in UTF-8 bytes.
  const r2 = validateRoom({ ...room(), wall: "ա".repeat(2100) });
  assert.equal(code(r2), "ROOM_INVALID");
  if (!r2.ok) assert.match(r2.message, /bytes/);
  // Huge item arrays are refused by size, not walked.
  const huge = Array.from({ length: 1000 }, () => ["cat", 0, 0, 0]);
  const r3 = validateRoom({ ...room(), items: huge });
  if (!r3.ok) assert.match(r3.message, /bytes/);
  assert.equal(code(r3), "ROOM_INVALID");
});

test("values JSON can't serialize are rejected", () => {
  const cyclic: Record<string, unknown> = room();
  cyclic.items = [cyclic];
  assert.equal(code(validateRoom(cyclic)), "ROOM_INVALID");
  assert.equal(code(validateRoom({ ...room(), v: 1n })), "ROOM_INVALID");
});

// ---------------------------------------------------------------------------
// create-order: room for lights only
// ---------------------------------------------------------------------------

test("create-order: light with a room stores the canonical layout", () => {
  const r = validateOrderInput({ ...lightBase, room: room() }, opt);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual("room" in r.value ? r.value.room : undefined, room());
});

test("create-order: light without a room (absent or null) -> room null", () => {
  for (const extra of [{}, { room: null }]) {
    const r = validateOrderInput({ ...lightBase, ...extra }, opt);
    assert.ok(r.ok);
    if (r.ok) assert.equal("room" in r.value ? r.value.room : "missing", null);
  }
});

test("create-order: light with a bad room -> ROOM_INVALID", () => {
  for (const bad of [{}, [], "room", 0, false, { ...room(), wall: "pink" }, { ...room(), items: [["cat", 8, 0, 0]] }]) {
    const r = validateOrderInput({ ...lightBase, room: bad }, opt);
    assert.equal(r.ok ? null : r.code, "ROOM_INVALID", JSON.stringify(bad));
  }
});

test("create-order: papers must not carry a room -> ROOM_NOT_ALLOWED", () => {
  const paper = { product: "burn", text: "the old year", consent: true };
  assert.ok(validateOrderInput(paper, opt).ok);
  assert.ok(validateOrderInput({ ...paper, room: null }, opt).ok);
  for (const bad of [room(), {}, 0, false, ""]) {
    const r = validateOrderInput({ ...paper, room: bad }, opt);
    assert.equal(r.ok ? null : r.code, "ROOM_NOT_ALLOWED", JSON.stringify(bad));
  }
  const ok = validateOrderInput(paper, opt);
  if (ok.ok) assert.ok(!("room" in ok.value));
});

// ---------------------------------------------------------------------------
// update-room decision
// ---------------------------------------------------------------------------

test("update-room: editable statuses", () => {
  assert.deepEqual(ROOM_EDITABLE_STATUSES, ["awaiting_launch", "pending", "paid"]);
});

test("update-room: unknown code -> 404 NOT_FOUND", () => {
  for (const o of [null, undefined]) {
    const d = checkRoomEditable(o);
    assert.ok(!d.ok);
    if (!d.ok) {
      assert.equal(d.status, 404);
      assert.equal(d.code, "NOT_FOUND");
    }
  }
});

test("update-room: lights in awaiting_launch / pending / paid are editable", () => {
  for (const product of ["light", "light_big"]) {
    for (const status of ["awaiting_launch", "pending", "paid"]) {
      assert.deepEqual(checkRoomEditable({ product, status }), { ok: true }, `${product} ${status}`);
    }
  }
});

test("update-room: other statuses and papers -> 409 ORDER_NOT_EDITABLE", () => {
  const cases = [
    ...["failed", "cancelled", "refunded"].map((status) => ({ product: "light", status })),
    ...["awaiting_launch", "pending", "paid"].map((status) => ({ product: "burn", status })),
    { product: "gift", status: "paid" },
    { product: "light", status: "weird" },
  ];
  for (const o of cases) {
    const d = checkRoomEditable(o);
    assert.ok(!d.ok, JSON.stringify(o));
    if (!d.ok) {
      assert.equal(d.status, 409);
      assert.equal(d.code, "ORDER_NOT_EDITABLE");
    }
  }
});
