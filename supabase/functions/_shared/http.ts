// HTTP helpers: JSON responses, CORS, error mapping. Uses only Web APIs
// (Request/Response/Headers), so it runs in Deno and Node alike.

import { ApiError, ErrorCode, errorBody } from "./errors.ts";
import { type CorsConfig, corsHeaders, isOriginAllowed } from "./cors.ts";

export const MAX_JSON_BODY_BYTES = 8 * 1024;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function errorResponse(err: ApiError, headers: Record<string, string> = {}): Response {
  const extra: Record<string, string> = { ...headers };
  if (err.status === 429) extra["Retry-After"] = "600";
  return jsonResponse(errorBody(err.code, err.message, err.field), err.status, extra);
}

/** Reads a JSON body with a size limit. Throws ApiError on bad input. */
export async function readJson(req: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, "Request body is too large.");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, "Request body is too large.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, ErrorCode.INVALID_JSON, "Request body must be valid JSON.");
  }
}

export type Handler = (req: Request) => Promise<Response>;

/**
 * Wraps a browser-facing JSON handler: method check, CORS (preflight and
 * response headers), ApiError -> error JSON, unexpected errors -> 500.
 * Requests without an Origin header (curl, servers) are allowed; requests
 * from a browser origin that is not allowed get 403.
 */
export function browserEndpoint(methods: string[], cors: CorsConfig, handler: Handler): Handler {
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    const ch = corsHeaders(origin, cors);

    if (origin && !isOriginAllowed(origin, cors)) {
      return jsonResponse(errorBody(ErrorCode.ORIGIN_NOT_ALLOWED, "Origin not allowed."), 403, ch);
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ch });
    }
    if (!methods.includes(req.method)) {
      return jsonResponse(errorBody(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."), 405, {
        ...ch,
        Allow: [...methods, "OPTIONS"].join(", "),
      });
    }

    try {
      const res = await handler(req);
      for (const [k, v] of Object.entries(ch)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err, ch);
      console.error("unhandled error", err);
      return jsonResponse(errorBody(ErrorCode.INTERNAL, "Something went wrong. Please try again."), 500, ch);
    }
  };
}
