import { describe, expect, it } from "vitest";
import { demoAdapter, demoOpportunities } from "@/lib/adapters/demo";
import type { YieldAdapter } from "@/lib/types";
import { assertNoMixedSources, MixedDataSourceError } from "@/lib/yield/freshness";
import { makeOpportunity } from "@/test/fixtures";
import { runScan } from "./scan";

const now = new Date("2026-06-01T12:00:00Z");
const liveAdapter: YieldAdapter = { id: "live-test", kind: "live", fetchOpportunities: async () => ({ adapterId: "live-test", opportunities: [makeOpportunity({ id: "live-1" }, now)], errors: [] }) };

describe("demo/live separation", () => {
  it("live scans never include demo data", async () => {
    const r = await runScan([liveAdapter, demoAdapter], "live", "mainnet-beta", now);
    expect(r.opportunities.map((o) => o.id)).toEqual(["live-1"]);
    expect(r.opportunities.every((o) => o.source.kind === "live")).toBe(true);
  });
  it("demo scans include only demo data", async () => {
    const r = await runScan([liveAdapter, demoAdapter], "demo", "mainnet-beta", now);
    expect(r.opportunities.length).toBe(3);
    expect(r.opportunities.every((o) => o.source.kind === "demo")).toBe(true);
  });
  it("drops items from a live adapter that are tagged demo", async () => {
    const sneaky: YieldAdapter = { id: "sneaky", kind: "live", fetchOpportunities: async () => ({ adapterId: "sneaky", opportunities: [makeOpportunity({ id: "fake", source: { kind: "demo", name: "x", fetchedAt: now.toISOString() } }, now)], errors: [] }) };
    const r = await runScan([sneaky], "live", "mainnet-beta", now);
    expect(r.opportunities).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/does not match scan mode/);
  });
  it("assertNoMixedSources throws on mixed data", () => {
    expect(() => assertNoMixedSources([makeOpportunity({ id: "l" }, now), ...demoOpportunities(now)])).toThrow(MixedDataSourceError);
    expect(() => assertNoMixedSources(demoOpportunities(now))).not.toThrow();
  });
  it("demo data is labeled and never executable", () => {
    for (const o of demoOpportunities(now)) {
      expect(o.source.kind).toBe("demo");
      expect(o.executable).toBe(false);
      expect(o.rateNotes.join(" ")).toMatch(/DEMO DATA/);
    }
  });
});

describe("adapter failures", () => {
  it("a throwing adapter does not break the scan", async () => {
    const broken: YieldAdapter = { id: "broken", kind: "live", fetchOpportunities: async () => { throw new Error("RPC down"); } };
    const r = await runScan([broken, liveAdapter], "live", "mainnet-beta", now);
    expect(r.opportunities.map((o) => o.id)).toEqual(["live-1"]);
    expect(r.errors).toEqual([{ adapterId: "broken", message: "RPC down" }]);
  });
});
