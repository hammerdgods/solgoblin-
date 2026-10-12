import { describe, expect, it } from "vitest";
import { formatAge, formatAmount, formatDuration, formatPercent, formatRate, formatToken, formatUsd, shortAddress } from "./format";

describe("formatting", () => {
  it("formats fractional rates as percentages", () => {
    expect(formatPercent(0.0474)).toBe("4.74%");
    expect(formatPercent(0.05089, 3)).toBe("5.089%");
    expect(formatPercent(0)).toBe("0.00%");
  });
  it("never invents a value for missing data", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
    expect(formatToken(null, "SOL")).toBe("—");
  });
  it("labels APY and APR explicitly so they are never confused", () => {
    expect(formatRate(0.05, "APY")).toBe("5.00% APY");
    expect(formatRate(0.0488, "APR")).toBe("4.88% APR");
    expect(formatRate(null, "APY")).toBe("—");
  });
  it("formats amounts, tokens and USD", () => {
    expect(formatAmount(1234.56789)).toBe("1,234.5679");
    expect(formatAmount(0.00000123)).toBe("0.00000123");
    expect(formatToken(1.5, "SOL")).toBe("1.5 SOL");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.9998)).toBe("$0.9998");
  });
  it("shortens addresses and describes durations and ages", () => {
    expect(shortAddress("EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY")).toBe("EZC9…CfqY");
    expect(formatDuration(0)).toMatch(/Instant/);
    expect(formatDuration(52)).toBe("~2.2 days");
    const now = new Date("2026-01-01T00:10:00Z");
    expect(formatAge("2026-01-01T00:09:30Z", now)).toBe("30s ago");
    expect(formatAge("2026-01-01T00:00:00Z", now)).toBe("10m ago");
  });
});
