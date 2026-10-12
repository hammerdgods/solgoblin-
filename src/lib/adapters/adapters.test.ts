import type { Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { KAMINO, MINTS } from "../constants";
import { createKaminoAdapter, kaminoOpportunityFromMetric, type KaminoReserveMetric } from "./kamino";
import { createNativeStakingAdapter, epochsPerYear, grossStakingApr, hoursUntilNextEpoch, selectValidators, stakingOpportunities, validatorNetApy, type StakingNetworkSnapshot, type VoteAccountInfo } from "./nativeStaking";

const now = new Date("2026-06-01T12:00:00Z");
const metric = (o: Partial<KaminoReserveMetric> = {}): KaminoReserveMetric => ({
  reserve: KAMINO.reserves.USDC.address,
  liquidityToken: "USDC",
  liquidityTokenMint: MINTS.USDC,
  supplyApy: 0.0474,
  borrowApy: 0.061,
  totalSupply: 1000,
  totalBorrow: 900,
  totalSupplyUsd: 1000,
  totalBorrowUsd: 900,
  ...o,
});

describe("Kamino adapter", () => {
  it("maps a reserve metric into a labeled live opportunity", () => {
    const o = kaminoOpportunityFromMetric("USDC", metric(), now, "mainnet-beta");
    if ("error" in o) throw new Error(o.error);
    expect(o.apy).toBe(0.0474);
    expect(o.rateType).toBe("lending-supply-apy");
    expect(o.source.kind).toBe("live");
    expect(o.metrics.utilization).toBeCloseTo(0.9);
    expect(o.executable).toBe(true);
    expect(o.rateNotes.join(" ")).toMatch(/Excludes KMNO/);
    expect(o.risks.map((r) => r.id)).toContain("stablecoin");
  });
  it("is view-only off mainnet", () => {
    const o = kaminoOpportunityFromMetric("USDC", metric(), now, "devnet");
    expect("error" in o ? null : o.executable).toBe(false);
  });
  it("flags high utilization as a high liquidity risk", () => {
    const o = kaminoOpportunityFromMetric("USDC", metric({ totalBorrow: 990 }), now, "mainnet-beta");
    if ("error" in o) throw new Error(o.error);
    expect(o.riskLevel).toBe("high");
  });
  it("rejects mint mismatches and implausible rates", () => {
    expect(kaminoOpportunityFromMetric("USDC", metric({ liquidityTokenMint: MINTS.wSOL }), now, "mainnet-beta")).toHaveProperty("error");
    expect(kaminoOpportunityFromMetric("USDC", metric({ supplyApy: 3 }), now, "mainnet-beta")).toHaveProperty("error");
    expect(kaminoOpportunityFromMetric("USDC", metric({ supplyApy: -0.1 }), now, "mainnet-beta")).toHaveProperty("error");
  });
  it("reports API outages and missing reserves as errors, never fake data", async () => {
    const down = createKaminoAdapter({ fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    const r = await down.fetchOpportunities({ network: "mainnet-beta", now });
    expect(r.opportunities).toEqual([]);
    expect(r.errors[0]).toMatch(/Kamino data unavailable/);
    const partial = createKaminoAdapter({ fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify([metric()]))) });
    const p = await partial.fetchOpportunities({ network: "mainnet-beta", now });
    expect(p.opportunities.map((o) => o.asset)).toEqual(["USDC"]);
    expect(p.errors.join(" ")).toMatch(/SOL reserve not found/);
    const garbage = createKaminoAdapter({ fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: true }))) });
    expect((await garbage.fetchOpportunities({ network: "mainnet-beta", now })).errors[0]).toMatch(/unexpected/);
  });
});

const vote = (votePubkey: string, o: Partial<VoteAccountInfo> = {}): VoteAccountInfo => ({ votePubkey, nodePubkey: "n", activatedStake: 1e15, commission: 0.05, delinquent: false, lastVote: 1, ...o });
const snap: StakingNetworkSnapshot = {
  validatorInflationRate: 0.036,
  totalSupplyLamports: 635e15,
  totalActiveStakeLamports: 438e15,
  epoch: 100,
  slotIndex: 216_000,
  slotsInEpoch: 432_000,
  secondsPerSlot: 0.4,
  minimumDelegationLamports: 1e9,
  stakeAccountRentLamports: 2_282_880,
  voteAccounts: [vote("A", { commission: 0 }), vote("B", { commission: 0.1, activatedStake: 2e15 }), vote("C", { delinquent: true }), vote("D", { commission: 0.5 })],
};

describe("native staking math", () => {
  it("derives gross APR from inflation, supply and active stake", () => {
    expect(grossStakingApr(snap)).toBeCloseTo((0.036 * 635) / 438, 10);
    expect(() => grossStakingApr({ ...snap, totalActiveStakeLamports: 0 })).toThrow(RangeError);
  });
  it("applies commission and per-epoch compounding", () => {
    const zero = validatorNetApy(snap, 0);
    const ten = validatorNetApy(snap, 0.1);
    expect(ten.apr).toBeCloseTo(zero.apr * 0.9, 10);
    expect(zero.apy).toBeGreaterThan(zero.apr);
    expect(epochsPerYear(snap)).toBeCloseTo(182.5, 1);
    expect(hoursUntilNextEpoch(snap)).toBeCloseTo(24, 5);
  });
});

describe("validator selection (trusted configuration)", () => {
  it("uses only the allowlist and skips delinquent validators", () => {
    const s = selectValidators(snap.voteAccounts, ["B", "C", "Z"], "mainnet-beta");
    expect(s.mode).toBe("allowlist");
    expect(s.validators.map((v) => v.votePubkey)).toEqual(["B"]);
    expect(s.problems.join(" ")).toMatch(/delinquent/);
    expect(s.problems.join(" ")).toMatch(/not found/);
  });
  it("requires an allowlist on mainnet", () => {
    const s = selectValidators(snap.voteAccounts, [], "mainnet-beta");
    expect(s.validators).toEqual([]);
    const ops = stakingOpportunities(snap, s, "mainnet-beta", now, "test");
    expect(ops).toHaveLength(1);
    expect(ops[0].executable).toBe(false);
  });
  it("auto-selects low-commission healthy validators on test networks", () => {
    const s = selectValidators(snap.voteAccounts, [], "devnet");
    expect(s.mode).toBe("auto-test");
    expect(s.validators.map((v) => v.votePubkey)).toEqual(["B", "A"]);
  });
  it("reports RPC failures as adapter errors", async () => {
    // Every RPC method fails like a rate-limited public endpoint.
    const failing = new Proxy({}, { get: () => async () => { throw new Error("429 Too Many Requests"); } }) as unknown as Connection;
    const adapter = createNativeStakingAdapter({ connection: failing, validatorAllowlist: [], rpcLabel: "t", cacheMs: 0 });
    const r = await adapter.fetchOpportunities({ network: "devnet", now });
    expect(r.opportunities).toEqual([]);
    expect(r.errors[0]).toMatch(/Staking data unavailable from RPC: 429/);
  });
});
