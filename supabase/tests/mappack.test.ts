// get_map() packed plot lists (migration 0012_map_packed): pins the byte layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeHeldPacked,
  decodeLitPacked,
  encodeHeldPacked,
  encodeLitPacked,
  lightNames,
  type PackedLight,
} from "../functions/_shared/mappack.ts";
import { LIGHT_COLORS, LIGHT_ICONS } from "../functions/_shared/validation.ts";

// Produced by PostgreSQL 16 with the exact expressions of 0012:
//   replace(encode(string_agg(int4send((id << 8) | (icon << 4) | (color << 1) | big), '' order by ...), 'base64'), E'\n', '')
const SQL_LIT = "AAAAAAAQ4TIBAAApBGy7Ww==";
const SQL_LIT_ROWS: PackedLight[] = [
  { cell_id: 0, icon_index: 0, color_index: 0, big: 0 },
  { cell_id: 4321, icon_index: 3, color_index: 1, big: 0 },
  { cell_id: 65536, icon_index: 2, color_index: 4, big: 1 },
  { cell_id: 289979, icon_index: 5, color_index: 5, big: 1 },
];
//   replace(encode(string_agg(substring(int4send(id) from 2), '' order by id), 'base64'), E'\n', '')
const SQL_HELD = "AAAAAAD/AAEAAP//AQAABGy7";
const SQL_HELD_IDS = [0, 255, 256, 65535, 65536, 289979];

test("lit_packed: decodes the PostgreSQL output", () => {
  assert.deepEqual(decodeLitPacked(SQL_LIT), SQL_LIT_ROWS);
});

test("lit_packed: byte layout id(3 bytes, big-endian) + icon<<4 | color<<1 | big", () => {
  const bytes = [...Buffer.from(SQL_LIT, "base64")];
  assert.equal(bytes.length, 16);
  // 4321 = 0x0010e1, icon 3 (star), colour 1 (red), small
  assert.deepEqual(bytes.slice(4, 8), [0x00, 0x10, 0xe1, (3 << 4) | (1 << 1) | 0]);
  // 289979 = 0x046cbb, icon 5 (pomegranate), colour 5 (violet), big
  assert.deepEqual(bytes.slice(12, 16), [0x04, 0x6c, 0xbb, (5 << 4) | (5 << 1) | 1]);
  assert.deepEqual(lightNames(SQL_LIT_ROWS[1]), { icon: "star", color: "red" });
  assert.deepEqual(lightNames(SQL_LIT_ROWS[3]), { icon: "pomegranate", color: "violet" });
});

test("lit_packed: encode is the inverse and sorts by cell_id", () => {
  assert.equal(encodeLitPacked(SQL_LIT_ROWS), SQL_LIT);
  assert.equal(encodeLitPacked([...SQL_LIT_ROWS].reverse()), SQL_LIT);
  // every icon x colour x big combination survives a round trip
  const all: PackedLight[] = [];
  let id = 0;
  for (let i = 0; i < LIGHT_ICONS.length; i++)
    for (let c = 0; c < LIGHT_COLORS.length; c++)
      for (const big of [0, 1] as const) all.push({ cell_id: (id += 4099), icon_index: i, color_index: c, big });
  assert.deepEqual(decodeLitPacked(encodeLitPacked(all)), all);
});

test("held_packed: 3 bytes per plot, decodes the PostgreSQL output", () => {
  assert.deepEqual(decodeHeldPacked(SQL_HELD), SQL_HELD_IDS);
  assert.deepEqual([...Buffer.from(SQL_HELD, "base64")].slice(3, 6), [0x00, 0x00, 0xff]);
  assert.equal(encodeHeldPacked([...SQL_HELD_IDS].reverse()), SQL_HELD);
});

test("packed: empty lists are empty strings; bad lengths throw", () => {
  assert.deepEqual(decodeLitPacked(""), []);
  assert.deepEqual(decodeHeldPacked(""), []);
  assert.equal(encodeLitPacked([]), "");
  assert.equal(encodeHeldPacked([]), "");
  assert.throws(() => decodeLitPacked("AAAA"), RangeError); // 3 bytes
  assert.throws(() => decodeHeldPacked("AAAAAA=="), RangeError); // 4 bytes
  assert.throws(() => encodeHeldPacked([0x1_000_000]), RangeError);
});

test("migration 0012: get_map returns packed lists, keeps the other keys and grants", () => {
  const sql = readFileSync(new URL("../migrations/0012_map_packed.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create or replace function public.get_map()"));
  for (const key of ["lit_packed", "held_packed", "total", "lit_count", "by_province", "warm", "updated_at"]) {
    assert.ok(body.includes(`'${key}',`), key);
  }
  assert.ok(!body.includes("'lit',") && !body.includes("'held',"), "lit/held arrays are gone");
  assert.match(body, /replace\(encode\([\s\S]*'base64'\), E'\\n', ''\)/);
  assert.match(sql, /grant execute on function public\.get_map\(\) to anon, authenticated, service_role;/);
});
