import type { Opportunity } from "@/lib/types";

/** Test fixture builder. Values are arbitrary test inputs, not market data. */
export function makeOpportunity(overrides: Partial<Opportunity> & { id: string }, now = new Date()): Opportunity {
  return {
    protocol: "Test protocol",
    strategyName: overrides.id,
    kind: "lending",
    asset: "USDC",
    network: "mainnet-beta",
    rateType: "lending-supply-apy",
    apy: 0.05,
    apr: null,
    rateNotes: [],
    source: { kind: "live", name: "test source", fetchedAt: now.toISOString() },
    liquidity: { depositDescription: "", withdrawalDescription: "", withdrawalDelayHours: 0, minimumDeposit: null },
    costs: { entryNetworkFeeLamports: 5000, exitNetworkFeeLamports: 5000, refundableRentLamports: 0, protocolFeeRate: 0, notes: [] },
    risks: [],
    riskLevel: "medium",
    executable: true,
    metrics: {},
    refs: {},
    ...overrides,
  };
}
