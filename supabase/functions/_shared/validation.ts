// Request validation. Pure module.

import type {
  Lang,
  LightColor,
  LightIcon,
  LightProductCode,
  PaperProductCode,
  OrderStatus,
  ProductCode,
  Result,
  RoomFloor,
  RoomItem,
  RoomItemType,
  RoomLayout,
  RoomWall,
} from "./types.ts";
import { ErrorCode } from "./errors.ts";

export const LANGS: readonly Lang[] = ["hy", "en", "ru"];
export const PAPER_PRODUCT_CODES: readonly PaperProductCode[] = ["burn", "burn_wish", "gift", "midnight"];
export const LIGHT_PRODUCT_CODES: readonly LightProductCode[] = ["light", "light_big"];
export const PRODUCT_CODES: readonly ProductCode[] = [...PAPER_PRODUCT_CODES, ...LIGHT_PRODUCT_CODES];
export const PRODUCTS_WITH_WISH: readonly ProductCode[] = ["burn_wish", "midnight"];
export const PRODUCTS_WITH_RECIPIENT: readonly ProductCode[] = ["gift"];

/** Order matters: get_map() returns positions in these lists (icon_index, color_index). */
export const LIGHT_ICONS: readonly LightIcon[] = ["tree", "home", "candle", "star", "gift", "pomegranate"];
export const LIGHT_COLORS: readonly LightColor[] = ["amber", "red", "green", "white", "blue", "violet"];

export const TEXT_MAX = 120;
/** A light's message (orders.text for light products). */
export const LIGHT_TEXT_MAX = 60;
export const SIGNATURE_MAX = 30;
/**
 * Plot ids: row * 540 + col on the 540 x 537 grid of the 111,111-plot map
 * (0004_cells_seed), so every id is < 290,000. Whether the id is a plot is
 * checked in the database (map_cells foreign key / get_cell).
 */
export const CELL_ID_MAX = 299_999;
export const WISH_MAX = 200;
export const RECIPIENT_MAX = 40;
export const EMAIL_MAX = 254;

// Invisible characters that only serve to hide or reorder text: zero-width
// space, LRM/RLM, bidi embeddings/overrides/isolates, word joiner and other
// invisible operators, BOM, soft hyphen. ZWJ/ZWNJ are kept (emoji sequences,
// some scripts).
const INVISIBLE_RE = /[­​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// C0/C1 control characters (includes \n, \r, \t).
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Normalizes user text: NFC, drops invisible characters, turns control
 * characters (newlines, tabs) into spaces, collapses whitespace, trims.
 * Non-strings become "".
 */
export function normalizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(INVISIBLE_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Length in Unicode code points (same as Postgres char_length). */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function parseLang(value: unknown, fallback: Lang = "hy"): Lang {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "am" || v === "hye") return "hy";
    if ((LANGS as readonly string[]).includes(v)) return v as Lang;
  }
  return fallback;
}

export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === "string" && (PRODUCT_CODES as readonly string[]).includes(value);
}

export function isLightProduct(value: unknown): value is LightProductCode {
  return typeof value === "string" && (LIGHT_PRODUCT_CODES as readonly string[]).includes(value);
}

/** A plot id: an integer 0..CELL_ID_MAX (or a string of up to 6 digits), else null. */
export function parseCellId(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d{1,6}$/.test(value.trim())) n = Number(value.trim());
  else return null;
  return Number.isInteger(n) && n >= 0 && n <= CELL_ID_MAX ? n : null;
}

export function parseLightIcon(value: unknown): LightIcon | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (LIGHT_ICONS as readonly string[]).includes(v) ? (v as LightIcon) : null;
}

export function parseLightColor(value: unknown): LightColor | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (LIGHT_COLORS as readonly string[]).includes(v) ? (v as LightColor) : null;
}

const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Returns the normalized (trimmed, lower-cased) email or null if invalid. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return null;
  return EMAIL_RE.test(email) ? email : null;
}

/** A paper (burn, burn_wish, gift, midnight). */
export interface OrderInput {
  product: PaperProductCode;
  text: string;
  wish_text: string | null;
  recipient_name: string | null;
  email: string | null;
  lang: Lang;
  show_on_stream: boolean;
}

export type PaperOrderInput = OrderInput;

/** A light on a map plot (light, light_big). `text` is the light's message. */
export interface LightOrderInput {
  product: LightProductCode;
  text: string;
  cell_id: number;
  light_icon: LightIcon;
  light_color: LightColor;
  light_signature: string | null;
  /** The light's 3D room (validateRoom), or null when none was sent. */
  room: RoomLayout | null;
  email: string | null;
  lang: Lang;
}

/** Discriminate with isLightProduct(input.product). */
export type CreateOrderInput = OrderInput | LightOrderInput;

export interface OrderValidationOptions {
  /** True when payments are disabled: we need the email to send the link at launch. */
  emailRequired: boolean;
}

function fail<T>(code: string, message: string): Result<T> {
  return { ok: false, code, message };
}

function isEmptyOptional(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && normalizeText(v) === "");
}

function validateEmail(b: Record<string, unknown>, opts: OrderValidationOptions): Result<string | null> {
  if (isEmptyOptional(b.email)) {
    if (opts.emailRequired) {
      return fail(ErrorCode.EMAIL_REQUIRED, "Email is required so we can send your payment link at launch.");
    }
    return { ok: true, value: null };
  }
  const email = normalizeEmail(b.email);
  if (email === null) return fail(ErrorCode.EMAIL_INVALID, "Email address is not valid.");
  return { ok: true, value: email };
}

/**
 * Validates the create-order request body, for papers and lights.
 * Narrow the result with isLightProduct(value.product).
 */
export function validateOrderInput(body: unknown, opts: OrderValidationOptions): Result<CreateOrderInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (b.consent !== true) {
    return fail(ErrorCode.CONSENT_REQUIRED, "Consent is required.");
  }

  if (!isProductCode(b.product)) {
    return fail(ErrorCode.INVALID_PRODUCT, "Unknown product.");
  }
  if (isLightProduct(b.product)) return validateLightFields(b, b.product, opts);
  const product = b.product;

  const text = normalizeText(b.text);
  if (text === "") return fail(ErrorCode.TEXT_REQUIRED, "Text is required.");
  if (charLength(text) > TEXT_MAX) {
    return fail(ErrorCode.TEXT_TOO_LONG, `Text must be at most ${TEXT_MAX} characters.`);
  }

  let wish_text: string | null = null;
  if (PRODUCTS_WITH_WISH.includes(product)) {
    wish_text = normalizeText(b.wish_text);
    if (wish_text === "") return fail(ErrorCode.WISH_REQUIRED, "A wish is required for this option.");
    if (charLength(wish_text) > WISH_MAX) {
      return fail(ErrorCode.WISH_TOO_LONG, `Wish must be at most ${WISH_MAX} characters.`);
    }
  } else if (!isEmptyOptional(b.wish_text)) {
    return fail(ErrorCode.WISH_NOT_ALLOWED, "This option does not include a wish.");
  }

  let recipient_name: string | null = null;
  if (PRODUCTS_WITH_RECIPIENT.includes(product)) {
    recipient_name = normalizeText(b.recipient_name);
    if (recipient_name === "") {
      return fail(ErrorCode.RECIPIENT_REQUIRED, "Recipient name is required for a gift.");
    }
    if (charLength(recipient_name) > RECIPIENT_MAX) {
      return fail(ErrorCode.RECIPIENT_TOO_LONG, `Recipient name must be at most ${RECIPIENT_MAX} characters.`);
    }
  } else if (!isEmptyOptional(b.recipient_name)) {
    return fail(ErrorCode.RECIPIENT_NOT_ALLOWED, "This option does not include a recipient.");
  }

  // Only lights come with a room.
  if (b.room !== undefined && b.room !== null) {
    return fail(ErrorCode.ROOM_NOT_ALLOWED, "This option does not include a room.");
  }

  const email = validateEmail(b, opts);
  if (!email.ok) return email;

  return {
    ok: true,
    value: {
      product,
      text,
      wish_text,
      recipient_name,
      email: email.value,
      lang: parseLang(b.lang),
      show_on_stream: b.show_on_stream === true,
    },
  };
}

/**
 * Light fields: message 1–60, plot, icon, colour, optional signature ≤ 30,
 * optional room (validateRoom; absent or null = no room). show_on_stream is ignored.
 */
function validateLightFields(
  b: Record<string, unknown>,
  product: LightProductCode,
  opts: OrderValidationOptions,
): Result<LightOrderInput> {
  const text = normalizeText(b.text);
  if (text === "") return fail(ErrorCode.TEXT_REQUIRED, "A message is required.");
  if (charLength(text) > LIGHT_TEXT_MAX) {
    return fail(ErrorCode.TEXT_TOO_LONG, `Message must be at most ${LIGHT_TEXT_MAX} characters.`);
  }

  const cell_id = parseCellId(b.cell_id);
  if (cell_id === null) return fail(ErrorCode.CELL_INVALID, "This plot is not on the map.");

  const light_icon = parseLightIcon(b.light_icon);
  if (light_icon === null) return fail(ErrorCode.ICON_INVALID, "Unknown light icon.");

  const light_color = parseLightColor(b.light_color);
  if (light_color === null) return fail(ErrorCode.COLOR_INVALID, "Unknown light colour.");

  let light_signature: string | null = null;
  if (!isEmptyOptional(b.light_signature)) {
    light_signature = normalizeText(b.light_signature);
    if (charLength(light_signature) > SIGNATURE_MAX) {
      return fail(ErrorCode.SIGNATURE_TOO_LONG, `Signature must be at most ${SIGNATURE_MAX} characters.`);
    }
  }

  let room: RoomLayout | null = null;
  if (b.room !== undefined && b.room !== null) {
    const r = validateRoom(b.room);
    if (!r.ok) return r;
    room = r.value;
  }

  if (!isEmptyOptional(b.wish_text)) {
    return fail(ErrorCode.WISH_NOT_ALLOWED, "This option does not include a wish.");
  }
  if (!isEmptyOptional(b.recipient_name)) {
    return fail(ErrorCode.RECIPIENT_NOT_ALLOWED, "This option does not include a recipient.");
  }

  const email = validateEmail(b, opts);
  if (!email.ok) return email;

  return {
    ok: true,
    value: {
      product,
      text,
      cell_id,
      light_icon,
      light_color,
      light_signature,
      room,
      email: email.value,
      lang: parseLang(b.lang),
    },
  };
}

// ---------------------------------------------------------------------------
// The light's 3D room (orders.room, migration 0010)
//
// Pure structured data, no free text, so it needs no moderation. Strict:
// exactly the keys below, values from fixed lists, integer ranges; anything
// else -> ROOM_INVALID. Footprint overlap is checked in the browser only.
// ---------------------------------------------------------------------------

export const ROOM_VERSION = 1;
export const ROOM_WALLS: readonly RoomWall[] = ["cream", "sage", "night", "berry"];
export const ROOM_FLOORS: readonly RoomFloor[] = ["oak", "walnut", "tile"];
export const ROOM_ITEM_TYPES: readonly RoomItemType[] = [
  "tree", "tree_small", "sofa", "armchair", "table", "tv", "fireplace", "gifts", "rug", "lamp",
  "shelf", "plant", "piano", "snowman", "cat", "dog", "candles", "pomegranates", "radio", "clock",
];
export const ROOM_MAX_ITEMS = 40;
/** Grid cells 0..ROOM_GRID_MAX on x and z. */
export const ROOM_GRID_MAX = 7;
/** Rotation in quarter turns, 0..ROOM_ROTATION_MAX. */
export const ROOM_ROTATION_MAX = 3;
/** Limit on JSON.stringify(room) in UTF-8 bytes (checked on the input and on the result). */
export const ROOM_MAX_BYTES = 4096;

const ROOM_KEYS = ["floor", "glow", "items", "v", "wall"]; // sorted

function roomInvalid(message: string): Result<RoomLayout> {
  return fail(ErrorCode.ROOM_INVALID, `Room layout is not valid: ${message}`);
}

function jsonBytes(value: unknown): number | null {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? new TextEncoder().encode(s).length : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isIntIn(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Validates a room layout:
 *   { "v": 1, "wall": cream|sage|night|berry, "floor": oak|walnut|tile, "glow": boolean,
 *     "items": [[type, x, z, r], ...] }   (0..40 items, x/z 0..7, r 0..3)
 * All five keys are required, no other keys; item order is preserved.
 * Returns a fresh canonical copy (key order v, wall, floor, glow, items).
 */
export function validateRoom(value: unknown): Result<RoomLayout> {
  const size = jsonBytes(value);
  if (size === null || size > ROOM_MAX_BYTES) return roomInvalid(`must be at most ${ROOM_MAX_BYTES} bytes of JSON.`);
  if (!isPlainObject(value)) return roomInvalid("must be a JSON object.");

  const keys = Object.keys(value).sort();
  if (keys.length !== ROOM_KEYS.length || keys.some((k, i) => k !== ROOM_KEYS[i])) {
    return roomInvalid("keys must be exactly v, wall, floor, glow, items.");
  }
  if (value.v !== ROOM_VERSION) return roomInvalid("v must be 1.");
  if (typeof value.wall !== "string" || !(ROOM_WALLS as readonly string[]).includes(value.wall)) {
    return roomInvalid("unknown wall.");
  }
  if (typeof value.floor !== "string" || !(ROOM_FLOORS as readonly string[]).includes(value.floor)) {
    return roomInvalid("unknown floor.");
  }
  if (typeof value.glow !== "boolean") return roomInvalid("glow must be true or false.");

  const rawItems = value.items;
  if (!Array.isArray(rawItems)) return roomInvalid("items must be an array.");
  if (rawItems.length > ROOM_MAX_ITEMS) return roomInvalid(`at most ${ROOM_MAX_ITEMS} items.`);

  const items: RoomItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it: unknown = rawItems[i];
    if (!Array.isArray(it) || it.length !== 4) return roomInvalid(`item ${i} must be [type, x, z, r].`);
    const [type, x, z, r] = it;
    if (typeof type !== "string" || !(ROOM_ITEM_TYPES as readonly string[]).includes(type)) {
      return roomInvalid(`item ${i} has an unknown type.`);
    }
    if (!isIntIn(x, ROOM_GRID_MAX) || !isIntIn(z, ROOM_GRID_MAX)) {
      return roomInvalid(`item ${i}: x and z must be integers 0..${ROOM_GRID_MAX}.`);
    }
    if (!isIntIn(r, ROOM_ROTATION_MAX)) return roomInvalid(`item ${i}: r must be an integer 0..${ROOM_ROTATION_MAX}.`);
    // `+ 0` turns -0 into 0.
    items.push([type as RoomItemType, x + 0, z + 0, r + 0]);
  }

  const room: RoomLayout = {
    v: ROOM_VERSION,
    wall: value.wall as RoomWall,
    floor: value.floor as RoomFloor,
    glow: value.glow,
    items,
  };
  const outSize = jsonBytes(room);
  if (outSize === null || outSize > ROOM_MAX_BYTES) return roomInvalid(`must be at most ${ROOM_MAX_BYTES} bytes of JSON.`);
  return { ok: true, value: room };
}

/** Order statuses in which the buyer may still change the room (update-room). */
export const ROOM_EDITABLE_STATUSES: readonly OrderStatus[] = ["awaiting_launch", "pending", "paid"];

/**
 * update-room decision for the order found by its code: null (unknown code)
 * -> 404 NOT_FOUND; not a light, or a status other than awaiting_launch /
 * pending / paid -> 409 ORDER_NOT_EDITABLE; else ok.
 */
export function checkRoomEditable(
  order: { product: string; status: string } | null | undefined,
): { ok: true } | { ok: false; status: 404 | 409; code: string; message: string } {
  if (!order) return { ok: false, status: 404, code: ErrorCode.NOT_FOUND, message: "Order not found." };
  if (!isLightProduct(order.product) || !(ROOM_EDITABLE_STATUSES as readonly string[]).includes(order.status)) {
    return { ok: false, status: 409, code: ErrorCode.ORDER_NOT_EDITABLE, message: "This room can no longer be changed." };
  }
  return { ok: true };
}

export interface WaitlistInput {
  email: string;
  lang: Lang;
}

export function validateWaitlistInput(body: unknown): Result<WaitlistInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;
  if (isEmptyOptional(b.email)) return fail(ErrorCode.EMAIL_REQUIRED, "Email is required.");
  const email = normalizeEmail(b.email);
  if (email === null) return fail(ErrorCode.EMAIL_INVALID, "Email address is not valid.");
  return { ok: true, value: { email, lang: parseLang(b.lang) } };
}

// ---------------------------------------------------------------------------
// Products: is it sold right now? (create-order and start-payment)
// ---------------------------------------------------------------------------

export interface ProductRow {
  code: string;
  price_amd: number;
  active: boolean;
}

/**
 * A product row from the database is sellable only when it exists and is
 * `active`. Inactive products (burn_wish, gift, midnight, light_big since
 * 0008) keep their rows for old orders but can't be bought or paid.
 */
export function checkProductAvailable(product: ProductRow | null | undefined): Result<ProductRow> {
  if (!product || product.active !== true) {
    return fail(ErrorCode.PRODUCT_UNAVAILABLE, "This option is not available right now.");
  }
  return { ok: true, value: product };
}

// ---------------------------------------------------------------------------
// join-bloggers
// ---------------------------------------------------------------------------

export type BloggerPlatform = "instagram" | "tiktok" | "youtube" | "facebook" | "telegram" | "other";
export const BLOGGER_PLATFORMS: readonly BloggerPlatform[] = ["instagram", "tiktok", "youtube", "facebook", "telegram", "other"];

/** Same limits as the blogger_applications CHECKs (0009). */
export const BLOGGER_LIMITS = {
  name: 80,
  link: 300,
  audience: 40,
  email: EMAIL_MAX,
  phone: 30,
  message: 500,
} as const;

export interface BloggerInput {
  name: string;
  link: string;
  platform: BloggerPlatform | null;
  audience: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  lang: Lang;
}

function tooLong<T>(field: keyof typeof BLOGGER_LIMITS): Result<T> {
  return { ok: false, code: ErrorCode.TOO_LONG, message: `${field} must be at most ${BLOGGER_LIMITS[field]} characters.`, field };
}

/**
 * A profile link: an absolute http(s) URL with a dotted host and no
 * user:password part. A link typed without a scheme ("instagram.com/x")
 * gets "https://". Returns the trimmed link (with the added scheme) or null.
 */
export function normalizeProfileLink(value: string): string | null {
  if (value === "" || /\s/.test(value)) return null;
  let s = value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (s.startsWith("//")) s = s.slice(2);
    s = `https://${s}`;
  }
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  return s;
}

const PHONE_RE = /^\+?[0-9 ()\-.]{5,30}$/;

/**
 * Validates the join-bloggers body. Text fields are normalized like papers
 * (NFC, invisible characters dropped, whitespace collapsed, trimmed). Error
 * order: INVALID_JSON, CONSENT_REQUIRED, then the fields in form order.
 */
export function validateBloggerInput(body: unknown): Result<BloggerInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(ErrorCode.INVALID_JSON, "Request body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (b.consent !== true) return fail(ErrorCode.CONSENT_REQUIRED, "Consent is required.");

  const name = normalizeText(b.name);
  if (name === "") return fail(ErrorCode.NAME_REQUIRED, "Name is required.");
  if (charLength(name) > BLOGGER_LIMITS.name) return tooLong("name");

  const rawLink = normalizeText(b.link);
  if (rawLink === "") return fail(ErrorCode.LINK_REQUIRED, "A link to your profile is required.");
  if (charLength(rawLink) > BLOGGER_LIMITS.link) return tooLong("link");
  const link = normalizeProfileLink(rawLink);
  if (link === null) return fail(ErrorCode.LINK_INVALID, "The link must be an http(s) address of your profile.");
  if (charLength(link) > BLOGGER_LIMITS.link) return tooLong("link");

  let platform: BloggerPlatform | null = null;
  if (!isEmptyOptional(b.platform)) {
    const p = typeof b.platform === "string" ? normalizeText(b.platform).toLowerCase() : "";
    if (!(BLOGGER_PLATFORMS as readonly string[]).includes(p)) {
      return fail(ErrorCode.PLATFORM_INVALID, "Unknown platform.");
    }
    platform = p as BloggerPlatform;
  }

  let audience: string | null = null;
  if (!isEmptyOptional(b.audience)) {
    audience = typeof b.audience === "number" && Number.isFinite(b.audience) ? String(b.audience) : normalizeText(b.audience);
    if (audience === "") audience = null;
    else if (charLength(audience) > BLOGGER_LIMITS.audience) return tooLong("audience");
  }

  if (isEmptyOptional(b.email)) return fail(ErrorCode.EMAIL_REQUIRED, "Email is required.");
  if (typeof b.email === "string" && b.email.trim().length > BLOGGER_LIMITS.email) return tooLong("email");
  const email = normalizeEmail(b.email);
  if (email === null) return fail(ErrorCode.EMAIL_INVALID, "Email address is not valid.");

  let phone: string | null = null;
  if (!isEmptyOptional(b.phone)) {
    phone = normalizeText(b.phone);
    if (charLength(phone) > BLOGGER_LIMITS.phone) return tooLong("phone");
    if (!PHONE_RE.test(phone) || phone.replace(/\D/g, "").length < 5) {
      return fail(ErrorCode.PHONE_INVALID, "Phone number is not valid.");
    }
  }

  let message: string | null = null;
  if (!isEmptyOptional(b.message)) {
    message = normalizeText(b.message);
    if (charLength(message) > BLOGGER_LIMITS.message) return tooLong("message");
  }

  return { ok: true, value: { name, link, platform, audience, email, phone, message, lang: parseLang(b.lang) } };
}
