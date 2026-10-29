// POST admin — backend for the small admin page at /admin/.
//
// Auth: header `x-admin-token` must equal the ADMIN_TOKEN secret (constant
// time). If ADMIN_TOKEN is unset or shorter than 32 chars every request gets
// 401. Failed attempts are rate-limited per IP hash (10 / 10 min -> 429):
// every request first counts as a failure, atomically, via check_rate_limit
// (so parallel guesses can't slip past the limit), and a request with the
// right token gives its count back (release_rate_limit, migration 0006).
//
// Body: { "action": "stats" | "list_orders" | "moderate" | "moderate_wish" | "mark_refunded"
//                  | "waitlist_csv" | "awaiting_launch_csv" | "bloggers_csv", ...params }

import { getConfig } from "../_shared/env.ts";
import { browserEndpoint, jsonResponse, readJson } from "../_shared/http.ts";
import { ApiError, ErrorCode } from "../_shared/errors.ts";
import { normalizeOrderCode } from "../_shared/codes.ts";
import {
  ADMIN_ACTIONS,
  type AdminAction,
  adminTokenMatches,
  awaitingLaunchCsv,
  type BloggerExportRow,
  bloggersCsv,
  parseListOrders,
  parseModerate,
  waitlistCsv,
} from "../_shared/admin.ts";
import { db, rateLimitAllows } from "../_shared/db.ts";
import { requestIpHash } from "../_shared/ratelimit.ts";

const cfg = getConfig();
const FAIL_LIMIT = 10;
const FAIL_WINDOW_SECONDS = 600;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) {
    console.error(`admin rpc ${fn} failed`, error);
    throw new ApiError(500, ErrorCode.INTERNAL, "Database error.");
  }
  return data as T;
}

function badRequest(message: string): ApiError {
  return new ApiError(400, "INVALID_REQUEST", message);
}

async function authenticate(req: Request): Promise<void> {
  const ipHash = await requestIpHash(req, cfg.ipHashSalt);
  const key = `admin_fail:${ipHash}`;

  // Count this attempt before looking at the token (atomic increment).
  const allowed = await rateLimitAllows(key, FAIL_LIMIT, FAIL_WINDOW_SECONDS);
  if (!allowed) throw new ApiError(429, ErrorCode.RATE_LIMITED, "Too many failed attempts. Try again later.");

  // Constant-time comparison (strings.timingSafeEqual).
  if (!adminTokenMatches(cfg.adminToken, req.headers.get("x-admin-token"))) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid admin token.");
  }

  // Right token: this attempt was not a failure.
  await rpc("release_rate_limit", { p_key: key, p_window_seconds: FAIL_WINDOW_SECONDS });
}

Deno.serve(browserEndpoint(["POST"], cfg.cors, async (req) => {
  await authenticate(req);

  const body = await readJson(req, 4 * 1024);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const action = b.action as AdminAction;
  if (!ADMIN_ACTIONS.includes(action)) throw badRequest("Unknown action.");

  switch (action) {
    case "stats":
      return jsonResponse(await rpc("admin_stats"));

    case "list_orders": {
      const p = parseListOrders(b);
      if (!p.ok) throw badRequest(p.message);
      const rows = await rpc<unknown[]>("admin_list_orders", {
        p_status: p.value.status,
        p_moderation: p.value.moderation,
        p_q: p.value.q,
        p_limit: p.value.limit,
        p_before_id: p.value.before_id,
      });
      return jsonResponse({ orders: rows });
    }

    case "moderate": {
      const p = parseModerate(b);
      if (!p.ok) throw badRequest(p.message);
      const r = await rpc<{ ok: boolean; error?: string }>("admin_moderate", {
        p_code: p.value.code,
        p_moderation: p.value.moderation,
        p_reason: p.value.reason,
      });
      if (!r.ok) throw new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");
      return jsonResponse(r);
    }

    // The order's wish in the fire (0013): same params as moderate.
    case "moderate_wish": {
      const p = parseModerate(b);
      if (!p.ok) throw badRequest(p.message);
      const r = await rpc<{ ok: boolean; error?: string }>("admin_moderate_wish", {
        p_code: p.value.code,
        p_moderation: p.value.moderation,
        p_reason: p.value.reason,
      });
      if (!r.ok && r.error === "WISH_NOT_FOUND") throw new ApiError(404, ErrorCode.NOT_FOUND, "This order has no wish.");
      if (!r.ok) throw new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");
      return jsonResponse(r);
    }

    case "mark_refunded": {
      const code = normalizeOrderCode(b.code);
      if (!code) throw badRequest("Invalid code.");
      const r = await rpc<{ ok: boolean; error?: string }>("admin_mark_refunded", { p_code: code });
      if (!r.ok && r.error === "ORDER_NOT_FOUND") throw new ApiError(404, ErrorCode.NOT_FOUND, "Order not found.");
      if (!r.ok) throw new ApiError(409, "ORDER_NOT_PAID", "Only paid orders can be refunded.");
      return jsonResponse(r);
    }

    case "waitlist_csv": {
      const rows = await rpc<{ email: string; lang: string; created_at: string }[]>("admin_export", { p_kind: "waitlist" });
      return jsonResponse({ csv: waitlistCsv(rows ?? []) });
    }

    case "awaiting_launch_csv": {
      const rows = await rpc<Parameters<typeof awaitingLaunchCsv>[1]>("admin_export", { p_kind: "awaiting_launch" });
      return jsonResponse({ csv: awaitingLaunchCsv(cfg.siteUrl, rows ?? []) });
    }

    case "bloggers_csv": {
      const rows = await rpc<BloggerExportRow[]>("admin_export", { p_kind: "bloggers" });
      return jsonResponse({ csv: bloggersCsv(rows ?? []) });
    }
  }
}));
