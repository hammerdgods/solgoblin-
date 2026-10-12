"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/** Fetch with loading/error state, optional polling, and stale-response protection. */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    apiFetch<T>(url)
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      })
      .catch((e: ClientApiError) => {
        if (id !== seq.current) return;
        setError(e);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [url, tick]);

  useEffect(() => {
    if (!url || !opts.refreshMs) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [url, opts.refreshMs]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, refresh, updatedAt };
}
