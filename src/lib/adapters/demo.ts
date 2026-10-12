import { BASE_FEE_LAMPORTS_PER_SIGNATURE } from "../constants";
import type { AdapterContext, AdapterResult, Opportunity, YieldAdapter } from "../types";

/**
 * DEMO adapter. Every value below is FICTIONAL sample data used only when the
 * user turns on demo mode. It is tagged `kind: "demo"` and the scanner refuses
 * to mix it with live data. Never present these numbers as real.
 */
export const DEMO_LABEL = "DEMO DATA — fictional values for exploring the interface. Not live, not a quote.";

export function demoOpportunities(now: Date): Opportunity[] {
  const source = { kind: "demo" as const, name: "YieldGoblin demo dataset (fictional)", fetchedAt: now.toISOString() };
  const common = { network: "devnet" as const, executable: false, executableReason: "Demo mode never builds transactions.", refs: {} };
  return [
    {
      ...common,
      id: "demo-stake-sol",
      protocol: "Demo native staking",
      strategyName: "SOL staking (demo validator)",
      kind: "native-staking",
      asset: "SOL",
      rateType: "staking-apy",
      apy: 0.06,
      apr: 0.0583,
      rateNotes: [DEMO_LABEL],
      source,
      liquidity: { depositDescription: "Demo only.", withdrawalDescription: "Demo: ~2 day unstaking delay.", withdrawalDelayHours: 48, minimumDeposit: 1 },
      costs: { entryNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE, exitNetworkFeeLamports: 2 * BASE_FEE_LAMPORTS_PER_SIGNATURE, refundableRentLamports: 2_282_880, protocolFeeRate: 0, notes: [DEMO_LABEL] },
      risks: [{ id: "demo", level: "low", title: "Demo", detail: DEMO_LABEL }],
      riskLevel: "low",
      metrics: { commission: 0.05 },
    },
    {
      ...common,
      id: "demo-lend-usdc",
      protocol: "Demo lending market",
      strategyName: "USDC supply (demo)",
      kind: "lending",
      asset: "USDC",
      rateType: "lending-supply-apy",
      apy: 0.045,
      apr: null,
      rateNotes: [DEMO_LABEL],
      source,
      liquidity: { depositDescription: "Demo only.", withdrawalDescription: "Demo: instant, subject to liquidity.", withdrawalDelayHours: 0, minimumDeposit: null },
      costs: { entryNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE, exitNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE, refundableRentLamports: 0, protocolFeeRate: 0, notes: [DEMO_LABEL] },
      risks: [{ id: "demo", level: "medium", title: "Demo", detail: DEMO_LABEL }],
      riskLevel: "medium",
      metrics: { utilization: 0.82 },
    },
    {
      ...common,
      id: "demo-lend-usdc-high",
      protocol: "Demo high-yield market",
      strategyName: "USDC supply, high utilization (demo)",
      kind: "lending",
      asset: "USDC",
      rateType: "lending-supply-apy",
      apy: 0.14,
      apr: null,
      rateNotes: [DEMO_LABEL],
      source,
      liquidity: { depositDescription: "Demo only.", withdrawalDescription: "Demo: withdrawals often blocked by 98% utilization.", withdrawalDelayHours: 0, minimumDeposit: null },
      costs: { entryNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE, exitNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE, refundableRentLamports: 0, protocolFeeRate: 0, notes: [DEMO_LABEL] },
      risks: [{ id: "liquidity", level: "high", title: "Withdrawal liquidity is tight (demo)", detail: DEMO_LABEL }],
      riskLevel: "high",
      metrics: { utilization: 0.98 },
    },
  ];
}

export const demoAdapter: YieldAdapter = {
  id: "demo",
  kind: "demo",
  async fetchOpportunities(ctx: AdapterContext): Promise<AdapterResult> {
    return { adapterId: "demo", opportunities: demoOpportunities(ctx.now), errors: [] };
  },
};
