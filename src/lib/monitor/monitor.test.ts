import { describe, expect, it, vi } from "vitest";
import { reviewPositions } from "@/lib/agent/review";
import { rankOpportunities, RISK_PROFILES } from "@/lib/scanner/rank";
import type { StrategySnapshotRow } from "@/lib/store/types";
import { makeOpportunity } from "@/test/fixtures";
import { dedupeAlerts, evaluateAdapterErrors, evaluateOpportunityAlerts, evaluateReviewAlerts } from "./evaluate";

vi.mock("@/lib/server/services", () => ({}));
const { estimateKaminoAccrual, summarizeFlows } = await import("@/lib/server/earnings");

const now = new Date("2026-06-01T12:00:00Z");
const t = { apyChangeAlertBps: 100, staleAfterSeconds: 900, utilizationWarning: 0.95 };
const snap = (id: string, apy: number): StrategySnapshotRow => ({ id: "s", opportunity_id: id, protocol: "p", asset: "USDC", network: "mainnet-beta", rate_type: "lending-supply-apy", apy, source_kind: "live", source_name: "x", fetched_at: now.toISOString(), metrics: {}, created_at: "2026-06-01T11:00:00Z" });

describe("monitoring alerts", () => {
  it("alerts on material APY changes only", () => {
    const o = makeOpportunity({ id: "k", apy: 0.035 }, now);
    const a = evaluateOpportunityAlerts([o], new Map([["k", snap("k", 0.05)]]), now, t);
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("apy-change");
    expect(a[0].severity).toBe("warning");
    expect(a[0].data).toMatchObject({ deltaBps: -150 });
    expect(evaluateOpportunityAlerts([makeOpportunity({ id: "k", apy: 0.0495 }, now)], new Map([["k", snap("k", 0.05)]]), now, t)).toHaveLength(0);
  });
  it("alerts on stale data and liquidity stress", () => {
    const stale = makeOpportunity({ id: "s", source: { kind: "live", name: "x", fetchedAt: "2026-06-01T09:00:00Z" } }, now);
    const tight = makeOpportunity({ id: "u", metrics: { utilization: 0.97 } }, now);
    const types = evaluateOpportunityAlerts([stale, tight], new Map(), now, t).map((a) => a.type);
    expect(types).toEqual(["stale-data", "liquidity"]);
  });
  it("never computes deltas for implausible rates", () => {
    const a = evaluateOpportunityAlerts([makeOpportunity({ id: "w", apy: 9e14 }, now)], new Map([["w", snap("w", 0.05)]]), now, t);
    expect(a.map((x) => x.type)).toEqual(["data-unavailable"]);
  });
  it("turns adapter errors into alerts", () => {
    expect(evaluateAdapterErrors([{ adapterId: "native-staking", message: "Allowlisted validator X is currently delinquent" }])[0].type).toBe("validator");
    expect(evaluateAdapterErrors([{ adapterId: "kamino-lend", message: "down" }])[0].type).toBe("data-unavailable");
  });
  it("dedupes repeated alerts within the window", () => {
    const drafts = evaluateOpportunityAlerts([makeOpportunity({ id: "u", metrics: { utilization: 0.97 } }, now)], new Map(), now, t);
    const recent = drafts.map((d) => ({ ...d, id: "1", created_at: "2026-06-01T11:30:00Z" }));
    expect(dedupeAlerts(drafts, recent, now)).toHaveLength(0);
    expect(dedupeAlerts(drafts, recent, new Date("2026-06-02T12:00:00Z"))).toHaveLength(1);
  });
});

describe("position review", () => {
  const ctx = { now, staleAfterSeconds: 900, principalByAsset: {}, usdPrices: { SOL: 100, USDC: 1 } };
  it("suggests review only when benefit exceeds switching costs", () => {
    const cur = makeOpportunity({ id: "cur", apy: 0.03 }, now);
    const alt = makeOpportunity({ id: "alt", apy: 0.06 }, now);
    const ranked = rankOpportunities([cur, alt], RISK_PROFILES.balanced, ctx);
    const big = reviewPositions([{ id: "p", asset: "USDC", amount: 10_000, opportunityId: "cur", label: "pos" }], ranked, { horizonDays: 90, minImprovementBps: 100, solUsd: 100, assetUsd: { USDC: 1 } });
    expect(big[0].verdict).toBe("review");
    expect(big[0].estimatedBenefit).toBeGreaterThan(0);
    const tiny = reviewPositions([{ id: "p", asset: "USDC", amount: 0.01, opportunityId: "cur", label: "pos" }], ranked, { horizonDays: 1, minImprovementBps: 100, solUsd: 100, assetUsd: { USDC: 1 } });
    expect(tiny[0].verdict).toBe("keep");
  });
  it("flags positions whose strategy no longer meets the user's settings", () => {
    const cur = makeOpportunity({ id: "cur", riskLevel: "high", risks: [{ id: "liquidity", level: "high", title: "t", detail: "utilization 99%" }] }, now);
    const r = reviewPositions([{ id: "p", asset: "USDC", amount: 100, opportunityId: "cur", label: "pos" }], rankOpportunities([cur], RISK_PROFILES.balanced, ctx), { horizonDays: 90, minImprovementBps: 100 });
    expect(r[0].verdict).toBe("review");
    expect(evaluateReviewAlerts("W", r)[0].type).toBe("position-review");
  });
});

describe("earnings integrity", () => {
  it("never reports accrued interest without recorded deposits", () => {
    expect(estimateKaminoAccrual("USDC", 105, 0).estimatedAccrued).toBeNull();
    expect(estimateKaminoAccrual("USDC", 90, 100).estimatedAccrued).toBeNull();
    expect(estimateKaminoAccrual("USDC", 101.5, 100).estimatedAccrued).toBeCloseTo(1.5);
  });
  it("counts only confirmed deposits and fees of landed transactions", () => {
    const base = { wallet: "W", network: "devnet", opportunity_id: "o", message_hash: "h", last_valid_block_height: 1, error: null, details: {}, created_at: "", updated_at: "" };
    const f = summarizeFlows([
      { ...base, id: "1", action: "kamino-deposit", asset: "USDC", amount: 100, status: "confirmed", signature: "a", fee_lamports: 5000 },
      { ...base, id: "2", action: "kamino-deposit", asset: "USDC", amount: 50, status: "submitted", signature: "b", fee_lamports: null },
      { ...base, id: "3", action: "native-stake", asset: "SOL", amount: 1, status: "failed", signature: "c", fee_lamports: 5000 },
      { ...base, id: "4", action: "native-stake", asset: "SOL", amount: 1, status: "prepared", signature: null, fee_lamports: null },
    ]);
    expect(f.kaminoNet).toEqual({ USDC: 100 });
    expect(f.deposits).toHaveLength(1);
    expect(f.feesPaidLamports).toBe(10_000);
  });
});
