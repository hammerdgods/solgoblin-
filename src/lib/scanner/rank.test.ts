import { describe, expect, it } from "vitest";
import { makeOpportunity } from "@/test/fixtures";
import { bestForAsset, DEFAULT_WEIGHTS, evaluateOpportunity, rankOpportunities, RISK_PROFILES } from "./rank";

const now = new Date("2026-06-01T12:00:00Z");
const ctx = { now, staleAfterSeconds: 900, principalByAsset: { USDC: 1000, SOL: 10 }, usdPrices: { SOL: 100, USDC: 1 } };

describe("risk-based filtering and ranking", () => {
  const safe = makeOpportunity({ id: "safe", apy: 0.05, riskLevel: "medium" }, now);
  const juicy = makeOpportunity({ id: "juicy", apy: 0.14, riskLevel: "high" }, now);

  it("excludes opportunities above the user's max risk level", () => {
    const ranked = rankOpportunities([juicy, safe], RISK_PROFILES.balanced, ctx);
    expect(ranked.find((r) => r.opportunity.id === "juicy")!.eligible).toBe(false);
    expect(bestForAsset(ranked, "USDC")!.opportunity.id).toBe("safe");
  });

  it("does not let the highest APY win automatically even when allowed", () => {
    const medium = makeOpportunity({ id: "medium", apy: 0.07, riskLevel: "medium" }, now);
    const risky = makeOpportunity({ id: "risky", apy: 0.09, riskLevel: "high" }, now);
    const ranked = rankOpportunities([risky, medium], RISK_PROFILES.adventurous, ctx);
    expect(ranked.every((r) => r.eligible)).toBe(true);
    // 0.09 - 0.04 high-risk penalty < 0.07 - 0.01 medium penalty
    expect(ranked[0].opportunity.id).toBe("medium");
  });

  it("penalizes withdrawal delay per day", () => {
    const instant = makeOpportunity({ id: "instant", apy: 0.05 }, now);
    const locked = makeOpportunity({ id: "locked", apy: 0.052, liquidity: { ...instant.liquidity, withdrawalDelayHours: 72 } }, now);
    const ranked = rankOpportunities([locked, instant], { ...RISK_PROFILES.balanced }, ctx);
    const l = ranked.find((r) => r.opportunity.id === "locked")!;
    expect(l.score.liquidityPenalty).toBeCloseTo(3 * DEFAULT_WEIGHTS.liquidityPenaltyPerDay, 10);
  });

  it("excludes opportunities whose withdrawal delay exceeds the preference", () => {
    const o = makeOpportunity({ id: "slow", liquidity: { depositDescription: "", withdrawalDescription: "", withdrawalDelayHours: 200, minimumDeposit: null } }, now);
    const r = evaluateOpportunity(o, RISK_PROFILES.balanced, ctx);
    expect(r.eligible).toBe(false);
    expect(r.exclusionReasons.join(" ")).toMatch(/Withdrawal delay/);
  });

  it("excludes assets the user does not allow", () => {
    const r = evaluateOpportunity(makeOpportunity({ id: "x" }, now), { ...RISK_PROFILES.balanced, allowedAssets: ["SOL"] }, ctx);
    expect(r.eligible).toBe(false);
  });

  it("enforces minimum deposit", () => {
    const o = makeOpportunity({ id: "min", asset: "SOL", liquidity: { depositDescription: "", withdrawalDescription: "", withdrawalDelayHours: 0, minimumDeposit: 20 } }, now);
    expect(evaluateOpportunity(o, RISK_PROFILES.balanced, ctx).exclusionReasons.join(" ")).toMatch(/below the minimum/);
  });

  it("is deterministic (stable order for ties)", () => {
    const a = makeOpportunity({ id: "a" }, now);
    const b = makeOpportunity({ id: "b" }, now);
    expect(rankOpportunities([b, a], RISK_PROFILES.balanced, ctx).map((r) => r.opportunity.id)).toEqual(["a", "b"]);
  });
});

describe("missing, stale and implausible data", () => {
  it("excludes stale data", () => {
    const stale = makeOpportunity({ id: "stale", source: { kind: "live", name: "t", fetchedAt: "2026-06-01T10:00:00Z" } }, now);
    const r = evaluateOpportunity(stale, RISK_PROFILES.balanced, ctx);
    expect(r.eligible).toBe(false);
    expect(r.exclusionReasons).toContain("Rate data is stale.");
  });
  it("excludes data with an invalid timestamp", () => {
    const bad = makeOpportunity({ id: "bad", source: { kind: "live", name: "t", fetchedAt: "not-a-date" } }, now);
    expect(evaluateOpportunity(bad, RISK_PROFILES.balanced, ctx).exclusionReasons).toContain("Rate data has no valid timestamp.");
  });
  it("excludes implausible or missing rates and gives them no score", () => {
    for (const apy of [Number.NaN, -0.01, 5, 9e14]) {
      const r = evaluateOpportunity(makeOpportunity({ id: "weird", apy }, now), RISK_PROFILES.adventurous, ctx);
      expect(r.eligible).toBe(false);
      expect(r.score.effectiveAnnualRate).toBeLessThanOrEqual(0);
    }
  });
  it("leaves SOL fees out of USDC estimates when no price exists, and says so", () => {
    const r = evaluateOpportunity(makeOpportunity({ id: "u" }, now), RISK_PROFILES.balanced, { ...ctx, usdPrices: {} });
    expect(r.feesConverted).toBe(false);
    expect(r.netYield.networkFees).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/not included/);
  });
  it("converts SOL network fees into USDC when prices are available", () => {
    const r = evaluateOpportunity(makeOpportunity({ id: "u" }, now), RISK_PROFILES.balanced, ctx);
    expect(r.netYield.networkFees).toBeCloseTo((10_000 / 1e9) * 100, 10);
  });
  it("warns when non-executable", () => {
    const r = evaluateOpportunity(makeOpportunity({ id: "v", executable: false, executableReason: "mainnet only" }, now), RISK_PROFILES.balanced, ctx);
    expect(r.eligible).toBe(true);
    expect(r.warnings).toContain("mainnet only");
  });
});
