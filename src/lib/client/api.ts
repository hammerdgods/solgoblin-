"use client";

import { useCallback, useEffect, useState } from "react";

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 45_000);
  try {
    const res = await fetch(url, { ...init, signal: init?.signal ?? controller.signal, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const err = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
      throw new ClientApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "HTTP_ERROR", err?.details);
    }
    return body as T;
  } catch (e) {
    if (e instanceof ClientApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ClientApiError("The request timed out. The server or an upstream data source may be slow.", 0, "TIMEOUT");
    throw new ClientApiError("Network error: could not reach the YieldGoblin server.", 0, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export interface FetchState<T> {
  data: T | null;
  error: ClientApiError | null;
  loading: boolean;
  refresh: () => void;
  updatedAt: number | null;
}

/**
 * Fetch with loading/error state, optional polling, and stale-response protection.
 * Loading is derived from a request key, so no state is set synchronously in effects.
 */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}): FetchState<T> {
  const [tick, setTick] = useState(0);
  const key = url ? `${url}#${tick}` : null;
  const [res, setRes] = useState<{ url: string | null; key: string | null; data: T | null; error: ClientApiError | null; updatedAt: number | null }>({ url: null, key: null, data: null, error: null, updatedAt: null });

  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    apiFetch<T>(url)
      .then((data) => {
        if (!cancelled) setRes({ url, key, data, error: null, updatedAt: Date.now() });
      })
      .catch((error: ClientApiError) => {
        // Keep the last good data for the same URL; surface the error alongside it.
        if (!cancelled) setRes((prev) => ({ url, key, data: prev.url === url ? prev.data : null, error, updatedAt: prev.url === url ? prev.updatedAt : null }));
      });
    return () => {
      cancelled = true;
    };
  }, [url, key]);

  useEffect(() => {
    if (!url || !opts.refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [url, opts.refreshMs]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const same = res.url === url;
  return { data: same ? res.data : null, error: same ? res.error : null, loading: key !== null && res.key !== key, refresh, updatedAt: same ? res.updatedAt : null };
}
