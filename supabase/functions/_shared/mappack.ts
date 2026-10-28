// Packed plot lists of get_map() (migration 0012_map_packed). Pure module:
// no npm/jsr imports, no Deno globals (atob/btoa exist in Deno, Node and
// browsers), so the frontend can use the same code.
// Contract: docs/ARCHITECTURE.md "Light up Armenia" → get_map().
//
// lit_packed : base64 (standard, padded) of 4 bytes per lit plot, by cell_id:
//              b0 = (id >> 16) & 255, b1 = (id >> 8) & 255, b2 = id & 255,
//              b3 = (icon_index << 4) | (color_index << 1) | big
// held_packed: base64 of 3 bytes per held plot (b0..b2 as above), by cell_id.

import { LIGHT_COLORS, LIGHT_ICONS } from "./validation.ts";
import type { LightColor, LightIcon } from "./types.ts";

/** Largest plot id the 3-byte encoding can carry (the map's ids are < 300,000). */
export const PACKED_ID_MAX = 0xff_ffff;

export interface PackedLight {
  cell_id: number;
  /** Position in LIGHT_ICONS (0..5). */
  icon_index: number;
  /** Position in LIGHT_COLORS (0..5). */
  color_index: number;
  /** 1 for a big light (light_big, no longer sold), else 0. */
  big: 0 | 1;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof b64 !== "string") throw new TypeError("packed map data must be a string");
  if (b64 === "") return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Decodes get_map().lit_packed. Throws on a length that is not a multiple of 4. */
export function decodeLitPacked(b64: string): PackedLight[] {
  const b = base64ToBytes(b64);
  if (b.length % 4 !== 0) throw new RangeError(`lit_packed: ${b.length} bytes is not a multiple of 4`);
  const out: PackedLight[] = new Array(b.length / 4);
  for (let i = 0, j = 0; i < b.length; i += 4, j++) {
    const flags = b[i + 3];
    out[j] = {
      cell_id: (b[i] << 16) | (b[i + 1] << 8) | b[i + 2],
      icon_index: flags >> 4,
      color_index: (flags >> 1) & 7,
      big: (flags & 1) as 0 | 1,
    };
  }
  return out;
}

/** Decodes get_map().held_packed into plot ids. Throws on a length that is not a multiple of 3. */
export function decodeHeldPacked(b64: string): number[] {
  const b = base64ToBytes(b64);
  if (b.length % 3 !== 0) throw new RangeError(`held_packed: ${b.length} bytes is not a multiple of 3`);
  const out: number[] = new Array(b.length / 3);
  for (let i = 0, j = 0; i < b.length; i += 3, j++) out[j] = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
  return out;
}

/** Icon and colour names of a decoded light (undefined for an index outside the lists). */
export function lightNames(l: PackedLight): { icon: LightIcon | undefined; color: LightColor | undefined } {
  return { icon: LIGHT_ICONS[l.icon_index], color: LIGHT_COLORS[l.color_index] };
}

function checkId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > PACKED_ID_MAX) throw new RangeError(`cell_id ${id} out of range`);
}

/** Inverse of decodeLitPacked (tests, mock APIs). Sorts by cell_id like get_map(). */
export function encodeLitPacked(lights: readonly PackedLight[]): string {
  const sorted = [...lights].sort((a, b) => a.cell_id - b.cell_id);
  const b = new Uint8Array(sorted.length * 4);
  sorted.forEach((l, j) => {
    checkId(l.cell_id);
    if (!Number.isInteger(l.icon_index) || l.icon_index < 0 || l.icon_index > 15) throw new RangeError("icon_index out of range");
    if (!Number.isInteger(l.color_index) || l.color_index < 0 || l.color_index > 7) throw new RangeError("color_index out of range");
    const i = j * 4;
    b[i] = (l.cell_id >> 16) & 255;
    b[i + 1] = (l.cell_id >> 8) & 255;
    b[i + 2] = l.cell_id & 255;
    b[i + 3] = (l.icon_index << 4) | (l.color_index << 1) | (l.big ? 1 : 0);
  });
  return bytesToBase64(b);
}

/** Inverse of decodeHeldPacked (tests, mock APIs). Sorts ids like get_map(). */
export function encodeHeldPacked(ids: readonly number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  const b = new Uint8Array(sorted.length * 3);
  sorted.forEach((id, j) => {
    checkId(id);
    b[j * 3] = (id >> 16) & 255;
    b[j * 3 + 1] = (id >> 8) & 255;
    b[j * 3 + 2] = id & 255;
  });
  return bytesToBase64(b);
}
