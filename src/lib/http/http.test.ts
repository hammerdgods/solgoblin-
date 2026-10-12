import { describe, expect, it, vi } from "vitest";
import { redact } from "../log";
import { fetchJson, UpstreamError } from "./fetchJson";
import { RateLimiter } from "./rateLimit";

const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("fetchJson (API/RPC failure handling)", () => {
  it("returns parsed JSON", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: 1 }));
    await expect(fetchJson("u", { upstream: "X", fetchImpl: f })).resolves.toEqual({ ok: 1 });
  });
  it("retries transient 5xx/429 and then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503, "busy")).mockResolvedValueOnce(res(429, "slow down")).mockResolvedValueOnce(res(200, { ok: 2 }));
    await expect(fetchJson("u", { upstream: "X", fetchImpl: f, retries: 2, backoffMs: 1 })).resolves.toEqual({ ok: 2 });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry client errors and surfaces the upstream message", async () => {
    const f = vi.fn().mockResolvedValue(res(400, { message: "obligation does not exist" }));
    const err = (await fetchJson("u", { upstream: "Kamino", fetchImpl: f, retries: 3, backoffMs: 1 }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/Kamino responded 400: obligation does not exist/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("gives up after retries on persistent outages", async () => {
    const f = vi.fn().mockImplementation(async () => res(502, "bad gateway"));
    await expect(fetchJson("u", { upstream: "X", fetchImpl: f, retries: 1, backoffMs: 1 })).rejects.toMatchObject({ status: 502, retryable: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("times out hanging requests", async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    await expect(fetchJson("u", { upstream: "Slow", fetchImpl: hang, timeoutMs: 20, retries: 0 })).rejects.toThrow(/Slow timed out after 20ms/);
  });
  it("reports invalid JSON", async () => {
    const f = vi.fn().mockResolvedValue(res(200, "<html>"));
    await expect(fetchJson("u", { upstream: "X", fetchImpl: f })).rejects.toThrow(/invalid JSON/);
  });
  it("reports network errors", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchJson("u", { upstream: "X", fetchImpl: f, retries: 0 })).rejects.toThrow(/X request failed: fetch failed/);
  });
});

describe("rate limiter", () => {
  it("limits per key within a window and resets", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    t = 1001;
    expect(rl.check("a").allowed).toBe(true);
  });
});

describe("log redaction", () => {
  it("never logs credentials", () => {
    const out = redact({ apiKey: "sk-ant-abc123", nested: { SUPABASE_SERVICE_ROLE_KEY: "eyJx.y.z", note: "using sk-ant-zzz999" }, url: "https://rpc.example.com/?api-key=SECRET123" }) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect(s).not.toContain("sk-ant-abc123");
    expect(s).not.toContain("sk-ant-zzz999");
    expect(s).not.toContain("SECRET123");
    expect(s).not.toContain("eyJx.y.z");
  });
});
