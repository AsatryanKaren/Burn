// Admin helpers: token check, request parsing, CSV exports. Pure module.

import type { Lang, ModerationStatus, OrderStatus } from "./types.ts";
import { timingSafeEqual } from "./strings.ts";
import { orderPageUrl } from "./config.ts";
import { normalizeOrderCode } from "./codes.ts";

export const ADMIN_ACTIONS = [
  "stats",
  "list_orders",
  "moderate",
  "mark_refunded",
  "waitlist_csv",
  "awaiting_launch_csv",
  "bloggers_csv",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const ORDER_STATUSES: readonly OrderStatus[] = ["awaiting_launch", "pending", "paid", "failed", "cancelled", "refunded"];
const MODERATION_STATUSES: readonly ModerationStatus[] = ["pending", "approved", "hidden", "rejected"];
const SETTABLE_MODERATION = ["approved", "hidden", "rejected"] as const;

/** Constant-time token check. A missing/short configured token never matches. */
export function adminTokenMatches(configured: string | null, provided: string | null): boolean {
  if (!configured || !provided) return false;
  return timingSafeEqual(configured, provided);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ListOrdersParams {
  status: OrderStatus | null;
  moderation: ModerationStatus | null;
  q: string | null;
  limit: number;
  before_id: number | null;
}

export function parseListOrders(b: Record<string, unknown>): Parsed<ListOrdersParams> {
  const status = b.status ?? null;
  if (status !== null && !(ORDER_STATUSES as readonly unknown[]).includes(status)) {
    return { ok: false, message: "Unknown status." };
  }
  const moderation = b.moderation ?? null;
  if (moderation !== null && !(MODERATION_STATUSES as readonly unknown[]).includes(moderation)) {
    return { ok: false, message: "Unknown moderation status." };
  }
  const q = typeof b.q === "string" && b.q.trim() ? b.q.trim().slice(0, 100) : null;
  const rawLimit = b.limit === undefined || b.limit === null ? 50 : Number(b.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) return { ok: false, message: "limit must be a positive integer." };
  const before = b.before_id === undefined || b.before_id === null ? null : Number(b.before_id);
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
    return { ok: false, message: "before_id must be a positive integer." };
  }
  return {
    ok: true,
    value: {
      status: status as OrderStatus | null,
      moderation: moderation as ModerationStatus | null,
      q,
      limit: Math.min(rawLimit, 200),
      before_id: before,
    },
  };
}

export interface ModerateParams {
  code: string;
  moderation: (typeof SETTABLE_MODERATION)[number];
  reason: string | null;
}

export function parseModerate(b: Record<string, unknown>): Parsed<ModerateParams> {
  const code = normalizeOrderCode(b.code);
  if (!code) return { ok: false, message: "Invalid code." };
  if (!(SETTABLE_MODERATION as readonly unknown[]).includes(b.moderation)) {
    return { ok: false, message: "moderation must be approved, hidden or rejected." };
  }
  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim().slice(0, 200) : null;
  return { ok: true, value: { code, moderation: b.moderation as ModerateParams["moderation"], reason } };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 field quoting + protection against spreadsheet formula injection. */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function waitlistCsv(rows: { email: string; lang: string; created_at: string }[]): string {
  return toCsv(["email", "lang", "created_at"], rows.map((r) => [r.email, r.lang, r.created_at]));
}

export function awaitingLaunchCsv(
  siteUrl: string,
  rows: { email: string; lang: Lang; code: string; product: string; amount_amd: number; created_at: string }[],
): string {
  return toCsv(
    ["email", "lang", "code", "product", "amount_amd", "link", "created_at"],
    rows.map((r) => [r.email, r.lang, r.code, r.product, r.amount_amd, orderPageUrl(siteUrl, r.lang, r.code), r.created_at]),
  );
}

export interface BloggerExportRow {
  id: number;
  created_at: string;
  status: string;
  name: string;
  link: string;
  platform: string | null;
  audience: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  lang: string;
}

export const BLOGGERS_CSV_HEADER = [
  "id",
  "created_at",
  "status",
  "name",
  "link",
  "platform",
  "audience",
  "email",
  "phone",
  "message",
  "lang",
];

/** Blogger applications, oldest first (admin_export 'bloggers', 0009). */
export function bloggersCsv(rows: BloggerExportRow[]): string {
  return toCsv(
    BLOGGERS_CSV_HEADER,
    rows.map((r) => [r.id, r.created_at, r.status, r.name, r.link, r.platform, r.audience, r.email, r.phone, r.message, r.lang]),
  );
}
