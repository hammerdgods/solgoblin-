import { describe, expect, it } from "vitest";
import { aprToApy, apyToApr, estimateNetYield, grossYieldForPeriod, rateDeltaBps } from "./math";

describe("APR/APY conversion", () => {
  it("compounds APR into a higher APY", () => {
    expect(aprToApy(0.05, 365)).toBeCloseTo(0.051267, 5);
    expect(aprToApy(0.05, 1)).toBeCloseTo(0.05, 10);
  });
  it("round-trips APY -> APR -> APY", () => {
    for (const apy of [0, 0.01, 0.0474, 0.2]) expect(aprToApy(apyToApr(apy, 182.5), 182.5)).toBeCloseTo(apy, 10);
  });
  it("rejects invalid inputs", () => {
    expect(() => aprToApy(Number.NaN, 365)).toThrow(RangeError);
    expect(() => aprToApy(0.05, 0)).toThrow(RangeError);
    expect(() => apyToApr(-1, 12)).toThrow(RangeError);
  });
});

describe("grossYieldForPeriod", () => {
  it("is zero for zero days or zero principal", () => {
    expect(grossYieldForPeriod(1000, 0.05, 0)).toBe(0);
    expect(grossYieldForPeriod(0, 0.05, 365)).toBe(0);
  });
  it("equals principal × APY over exactly one year", () => {
    expect(grossYieldForPeriod(1000, 0.05, 365)).toBeCloseTo(50, 8);
  });
  it("scales sub-linearly over shorter periods (compounding captured by APY)", () => {
    const half = grossYieldForPeriod(1000, 0.1, 182.5);
    expect(half).toBeLessThan(50);
    expect(half).toBeCloseTo(1000 * (Math.sqrt(1.1) - 1), 8);
  });
});

describe("estimateNetYield (fee-adjusted)", () => {
  it("subtracts protocol and network fees", () => {
    const r = estimateNetYield({ principal: 1000, apy: 0.05, days: 365, protocolFeeRate: 0.001, networkFeesInAsset: 0.5 });
    expect(r.protocolFee).toBeCloseTo(1, 10);
    expect(r.grossYield).toBeCloseTo(999 * 0.05, 8);
    expect(r.netYield).toBeCloseTo(999 * 0.05 - 1 - 0.5, 8);
    expect(r.effectiveAnnualRate).toBeCloseTo(r.netYield / 1000, 10);
  });
  it("can be negative when fees exceed yield on small amounts", () => {
    const r = estimateNetYield({ principal: 1, apy: 0.05, days: 7, protocolFeeRate: 0, networkFeesInAsset: 0.01 });
    expect(r.netYield).toBeLessThan(0);
  });
  it("applies warm-up days before earning", () => {
    const withWarmup = estimateNetYield({ principal: 100, apy: 0.06, days: 30, protocolFeeRate: 0, networkFeesInAsset: 0, warmupDays: 3 });
    expect(withWarmup.earningDays).toBe(27);
    expect(withWarmup.grossYield).toBeCloseTo(grossYieldForPeriod(100, 0.06, 27), 10);
  });
  it("computes a break-even time that makes net yield zero", () => {
    const r = estimateNetYield({ principal: 100, apy: 0.05, days: 365, protocolFeeRate: 0, networkFeesInAsset: 0.1 });
    expect(r.breakEvenDays).not.toBeNull();
    expect(grossYieldForPeriod(100, 0.05, r.breakEvenDays!)).toBeCloseTo(0.1, 8);
  });
  it("reports no break-even at zero APY with costs", () => {
    expect(estimateNetYield({ principal: 100, apy: 0, days: 30, protocolFeeRate: 0, networkFeesInAsset: 1 }).breakEvenDays).toBeNull();
  });
  it("returns null annualized rate for zero principal", () => {
    expect(estimateNetYield({ principal: 0, apy: 0.05, days: 30, protocolFeeRate: 0, networkFeesInAsset: 0 }).effectiveAnnualRate).toBeNull();
  });
  it("rejects invalid fee inputs", () => {
    expect(() => estimateNetYield({ principal: 1, apy: 0.05, days: 1, protocolFeeRate: 1, networkFeesInAsset: 0 })).toThrow(RangeError);
    expect(() => estimateNetYield({ principal: 1, apy: 0.05, days: 1, protocolFeeRate: 0, networkFeesInAsset: -1 })).toThrow(RangeError);
  });
});

describe("rateDeltaBps", () => {
  it("returns basis points", () => {
    expect(rateDeltaBps(0.05, 0.0625)).toBe(125);
    expect(rateDeltaBps(0.05, 0.04)).toBe(-100);
  });
});
