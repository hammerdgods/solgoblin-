import { ZodError, type ZodType } from "zod";
import { ConfigError } from "../config/serverSchema";
import { UnsupportedNetworkError } from "../errors";
import { log } from "../log";
import { UpstreamError } from "./fetchJson";
import { clientKey, limiterFor } from "./rateLimit";

/** Error with a safe, user-facing message and HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function jsonError(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit): Response {
  const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return Response.json(body, { status, headers });
}

export function enforceRateLimit(req: Request, route: string, limit: number, windowMs = 60_000): void {
  const r = limiterFor(route, limit, windowMs).check(clientKey(req));
  if (!r.allowed) throw new ApiError(429, "RATE_LIMITED", `Too many requests. Retry in ${r.retryAfterSeconds}s.`, { retryAfterSeconds: r.retryAfterSeconds });
}

export async function parseJsonBody<T>(req: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "Request validation failed.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return parsed.data;
}

/** Wrap a route handler with consistent error handling. Never leaks stack traces or secrets. */
export function handle(route: string, fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof ApiError) {
        const headers = err.status === 429 && typeof err.details === "object" && err.details && "retryAfterSeconds" in err.details ? { "Retry-After": String((err.details as { retryAfterSeconds: number }).retryAfterSeconds) } : undefined;
        return jsonError(err.status, err.code, err.message, err.details, headers);
      }
      if (err instanceof ZodError) return jsonError(400, "INVALID_INPUT", "Validation failed.");
      if (err instanceof UnsupportedNetworkError) return jsonError(400, "UNSUPPORTED_NETWORK", err.message);
      if (err instanceof ConfigError) {
        log.error(route, "configuration error", { message: err.message });
        return jsonError(500, "CONFIG_ERROR", err.message);
      }
      if (err instanceof UpstreamError) {
        log.warn(route, "upstream error", { upstream: err.upstream, status: err.status, message: err.message });
        return jsonError(502, "UPSTREAM_UNAVAILABLE", err.message);
      }
      log.error(route, "unhandled error", { message: err instanceof Error ? err.message : String(err) });
      return jsonError(500, "INTERNAL_ERROR", "Unexpected server error.");
    }
  };
}
