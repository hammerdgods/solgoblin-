/**
 * fetch with timeout, bounded retries for transient failures, and typed errors.
 * Used for every outbound HTTP call (Kamino API, RPC wrapper, etc.).
 */

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly upstream: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchJsonOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  retries?: number;
  /** Base backoff in ms, doubled on each retry. */
  backoffMs?: number;
  /** Label for error messages and logs, e.g. "Kamino API". */
  upstream: string;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, backoffMs = 300, upstream, fetchImpl = fetch, ...init } = opts;
  let lastError: UpstreamError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try {
          const body = JSON.parse(text) as { message?: string; error?: string };
          detail = body.message ?? body.error ?? detail;
        } catch {
          /* non-JSON error body */
        }
        lastError = new UpstreamError(`${upstream} responded ${res.status}: ${detail}`, upstream, res.status, isRetryableStatus(res.status));
        if (!lastError.retryable) throw lastError;
        continue;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new UpstreamError(`${upstream} returned invalid JSON`, upstream, res.status, false);
      }
    } catch (err) {
      if (err instanceof UpstreamError) {
        if (!err.retryable) throw err;
        lastError = err;
        continue;
      }
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = new UpstreamError(
        aborted ? `${upstream} timed out after ${timeoutMs}ms` : `${upstream} request failed: ${err instanceof Error ? err.message : String(err)}`,
        upstream,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new UpstreamError(`${upstream} request failed`, upstream, null, true);
}
