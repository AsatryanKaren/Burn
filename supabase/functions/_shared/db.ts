// Database access with the service role (impure). All writes from edge
// functions go through here. The browser never gets these privileges.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "./env.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import type {
  Lang,
  LightColor,
  LightIcon,
  ModerationStatus,
  OrderStatus,
  PaymentProvider,
  ProductCode,
  RoomLayout,
} from "./types.ts";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const cfg = getConfig();
    client = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "x-client-info": "burn-edge-functions" } },
    });
  }
  return client;
}

function dbError(context: string, error: unknown): ApiError {
  console.error(`db error (${context})`, error);
  return new ApiError(500, ErrorCode.INTERNAL, "Something went wrong. Please try again.");
}

export interface OrderRow {
  id: number;
  code: string;
  product: ProductCode;
  amount_amd: number;
  status: OrderStatus;
  lang: Lang;
  email: string | null;
  text: string;
  wish_text: string | null;
  recipient_name: string | null;
  show_on_stream: boolean;
  moderation: ModerationStatus;
  burn_number: number | null;
  provider: PaymentProvider | null;
  provider_payment_id: string | null;
  provider_order_num: number;
  created_at: string;
  paid_at: string | null;
  // light products only (null for papers)
  cell_id: number | null;
  light_icon: LightIcon | null;
  light_color: LightColor | null;
  light_signature: string | null;
  /** The light's 3D room (0010); null for papers and lights without one. */
  room: RoomLayout | null;
}

const ORDER_COLUMNS =
  "id, code, product, amount_amd, status, lang, email, text, wish_text, recipient_name, show_on_stream, " +
  "moderation, burn_number, provider, provider_payment_id, provider_order_num, created_at, paid_at, " +
  "cell_id, light_icon, light_color, light_signature, room";

export const PAYABLE_STATUSES: readonly OrderStatus[] = ["awaiting_launch", "pending", "failed"];

export async function getProduct(code: ProductCode): Promise<{ code: string; price_amd: number; active: boolean } | null> {
  const { data, error } = await db().from("products").select("code, price_amd, active").eq("code", code).maybeSingle();
  if (error) throw dbError("getProduct", error);
  return data;
}

export async function findOrderByCode(code: string): Promise<OrderRow | null> {
  const { data, error } = await db().from("orders").select(ORDER_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw dbError("findOrderByCode", error);
  return data as OrderRow | null;
}

export async function findOrderByProviderNum(num: number): Promise<OrderRow | null> {
  const { data, error } = await db().from("orders").select(ORDER_COLUMNS).eq("provider_order_num", num).maybeSingle();
  if (error) throw dbError("findOrderByProviderNum", error);
  return data as OrderRow | null;
}

export interface NewOrder {
  code: string;
  product: ProductCode;
  amount_amd: number;
  status: OrderStatus;
  lang: Lang;
  email: string | null;
  text: string;
  wish_text: string | null;
  recipient_name: string | null;
  show_on_stream: boolean;
  moderation: ModerationStatus;
  moderation_reason: string | null;
  provider: PaymentProvider | null;
  ip_hash: string;
  // light products only
  cell_id?: number | null;
  light_icon?: LightIcon | null;
  light_color?: LightColor | null;
  light_signature?: string | null;
  room?: RoomLayout | null;
}

/** Inserts an order; retries with a new code on the (astronomically rare) code collision. */
export async function insertOrder(row: Omit<NewOrder, "code">, newCode: () => string): Promise<OrderRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db().from("orders").insert({ ...row, code: newCode() }).select(ORDER_COLUMNS).single();
    if (!error) return data as OrderRow;
    if (error.code === "23505" && String(error.message).includes("orders_code_key")) continue;
    throw dbError("insertOrder", error);
  }
  throw dbError("insertOrder", "code collision retries exhausted");
}

export async function markOrderFailed(code: string): Promise<void> {
  const { error } = await db().from("orders").update({ status: "failed" }).eq("code", code).eq("status", "pending");
  if (error) throw dbError("markOrderFailed", error);
}

/** Cancels a still-pending order (e.g. its plot was taken between check and hold). */
export async function cancelPendingOrder(id: number): Promise<void> {
  const { error } = await db().from("orders").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  if (error) throw dbError("cancelPendingOrder", error);
}

// ---------------------------------------------------------------------------
// Map plots
// ---------------------------------------------------------------------------

/** Minutes a plot stays reserved for an unpaid light (contract: 30). */
export const CELL_HOLD_MINUTES = 30;

export interface CellInfo {
  cell_id: number;
  province: string;
  town_index: number;
  status: "free" | "held" | "lit";
}

/** Public view of a plot (get_cell RPC); null when the id is not a map plot. */
export async function getCell(cellId: number): Promise<CellInfo | null> {
  const { data, error } = await db().rpc("get_cell", { p_cell_id: cellId });
  if (error) throw dbError("get_cell", error);
  return (data as CellInfo | null) ?? null;
}

/** Takes or re-takes the plot for this light order (hold_cell RPC). False when another order has it. */
export async function holdCell(orderId: number, cellId: number, minutes = CELL_HOLD_MINUTES): Promise<boolean> {
  const { data, error } = await db().rpc("hold_cell", { p_order_id: orderId, p_cell_id: cellId, p_minutes: minutes });
  if (error) throw dbError("hold_cell", error);
  return data === true;
}

/**
 * Replaces the room of a light order, only while it is still editable
 * (conditional update, so a refund/cancel racing with it wins). Returns
 * false when no row matched.
 */
export async function updateOrderRoom(
  orderId: number,
  room: RoomLayout,
  editableStatuses: readonly OrderStatus[],
): Promise<boolean> {
  const { data, error } = await db()
    .from("orders")
    .update({ room })
    .eq("id", orderId)
    .in("product", ["light", "light_big"])
    .in("status", editableStatuses as OrderStatus[])
    .select("id");
  if (error) throw dbError("updateOrderRoom", error);
  return Array.isArray(data) && data.length > 0;
}

/**
 * One warmth per IP hash for a lit plot's room (room_add_warmth, 0011).
 * Returns the raw RPC answer: { ok: true, warmth, already } or
 * { ok: false, error: "NOT_LIT" | "INVALID_ARGS" } (see _shared/warmth.ts).
 */
export async function addRoomWarmth(cellId: number, ipHash: string): Promise<unknown> {
  const { data, error } = await db().rpc("room_add_warmth", { p_cell_id: cellId, p_ip_hash: ipHash });
  if (error) throw dbError("room_add_warmth", error);
  return data;
}

/** Counts a visit of a lit plot's room (room_add_visit, 0011): { ok: true, visits } or { ok: false, error: "NOT_LIT" }. */
export async function addRoomVisit(cellId: number): Promise<unknown> {
  const { data, error } = await db().rpc("room_add_visit", { p_cell_id: cellId });
  if (error) throw dbError("room_add_visit", error);
  return data;
}

export async function getMapCell(cellId: number): Promise<{ province: string; town_index: number } | null> {
  const { data, error } = await db().from("map_cells").select("province, town_index").eq("id", cellId).maybeSingle();
  if (error) throw dbError("getMapCell", error);
  return data as { province: string; town_index: number } | null;
}

export async function getGiftShare(orderId: number): Promise<number | null> {
  const { data, error } = await db().from("gift_ledger").select("amount_amd").eq("order_id", orderId).maybeSingle();
  if (error) throw dbError("getGiftShare", error);
  return data ? (data.amount_amd as number) : null;
}

export interface ConfirmResult {
  ok: boolean;
  /** null for lights (they get no burn number). */
  burn_number: number | null;
  already: boolean;
  error?: string;
  /** Lights only: paid, but another order holds the plot (admin moves or refunds). */
  cell_conflict?: boolean;
}

/** The ONLY way an order becomes paid. Call after verifying the payment with the provider. */
export async function confirmPayment(
  code: string,
  provider: PaymentProvider,
  paymentId: string,
  amountAmd: number,
): Promise<ConfirmResult> {
  const { data, error } = await db().rpc("confirm_payment", {
    p_code: code,
    p_provider: provider,
    p_payment_id: paymentId,
    p_amount: amountAmd,
  });
  if (error) throw dbError("confirm_payment", error);
  return data as ConfirmResult;
}

export type AttemptResult =
  | {
    ok: true;
    code: string;
    status: OrderStatus;
    provider: PaymentProvider;
    provider_order_num: number;
    amount_amd: number;
    lang: Lang;
    email: string | null;
  }
  | { ok: false; error: "INVALID_ARGS" | "ORDER_NOT_FOUND" | "ALREADY_PAID" | "ORDER_NOT_PAYABLE" };

export async function beginPaymentAttempt(
  code: string,
  provider: PaymentProvider,
  newOrderNum: boolean,
): Promise<AttemptResult> {
  const { data, error } = await db().rpc("begin_payment_attempt", {
    p_code: code,
    p_provider: provider,
    p_new_order_num: newOrderNum,
  });
  if (error) throw dbError("begin_payment_attempt", error);
  return data as AttemptResult;
}

/** Fixed-window rate limit; true when allowed. */
export async function rateLimitAllows(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await db().rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw dbError("check_rate_limit", error);
  return data === true;
}

export async function addToWaitlist(row: { email: string; lang: Lang; ip_hash: string }): Promise<void> {
  const { error } = await db().from("waitlist").upsert(row, { onConflict: "email", ignoreDuplicates: true });
  if (error) throw dbError("addToWaitlist", error);
}

/** One blogger application (join-bloggers). Duplicate emails simply add another row. */
export async function addBloggerApplication(row: {
  name: string;
  link: string;
  platform: string | null;
  audience: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  lang: Lang;
  ip_hash: string;
}): Promise<void> {
  const { error } = await db().from("blogger_applications").insert(row);
  if (error) throw dbError("addBloggerApplication", error);
}

/** Raw audit log of provider traffic. Payload must already be sanitized. */
export async function logPaymentEvent(
  provider: string,
  kind: string,
  orderCode: string | null,
  payload: unknown,
): Promise<void> {
  const { error } = await db().from("payment_events").insert({
    provider,
    kind,
    order_code: orderCode,
    payload: payload ?? {},
  });
  if (error) throw dbError("logPaymentEvent", error);
}

/**
 * A payment that reached the bank for an order already paid by another
 * payment (possible double charge). Logged as kind 'needs_refund'; admin
 * stats count these (migration 0006).
 */
export async function logNeedsRefund(
  provider: PaymentProvider,
  orderCode: string,
  paymentId: string,
  amountAmd: number | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await logPaymentEvent(provider, "needs_refund", orderCode, {
    payment_id: String(paymentId).slice(0, 200),
    amount_amd: amountAmd,
    ...detail,
  });
}

/** Ameria OrderIDs we sent in InitPayment for this order (from the audit log). */
export async function ameriaOrderIdsForOrder(code: string): Promise<number[]> {
  const { data, error } = await db()
    .from("payment_events")
    .select("payload")
    .eq("provider", "ameria")
    .eq("kind", "init")
    .eq("order_code", code)
    .limit(50);
  if (error) throw dbError("ameriaOrderIdsForOrder", error);
  const rows = (data ?? []) as { payload: Record<string, unknown> | null }[];
  return rows
    .map((r) => Number(r.payload?.OrderID))
    .filter((n: number) => Number.isSafeInteger(n));
}

/** Order code for an Ameria OrderID we sent earlier (from the audit log). */
export async function orderCodeForAmeriaOrderId(orderId: number): Promise<string | null> {
  const { data, error } = await db()
    .from("payment_events")
    .select("order_code")
    .eq("provider", "ameria")
    .eq("kind", "init")
    .eq("payload->>OrderID", String(orderId))
    .not("order_code", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("orderCodeForAmeriaOrderId", error);
  return (data?.order_code as string | undefined) ?? null;
}
