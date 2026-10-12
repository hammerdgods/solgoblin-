import { z } from "zod";
import { BASE_FEE_LAMPORTS_PER_SIGNATURE, KAMINO, type KaminoReserveKey, type SolanaNetwork } from "../constants";
import { fetchJson } from "../http/fetchJson";
import type { AdapterContext, AdapterResult, Opportunity, RiskFactor, YieldAdapter } from "../types";

/**
 * Kamino Lend adapter (LIVE).
 * Data: GET {api}/kamino-market/{market}/reserves/metrics — documented at
 * https://kamino.com/docs/build/borrow/market-data-metrics
 * Rates are interest-only supply APY; KMNO/farm incentives are NOT included.
 */

const reserveMetricSchema = z.object({
  reserve: z.string(),
  liquidityToken: z.string(),
  liquidityTokenMint: z.string(),
  supplyApy: z.coerce.number(),
  borrowApy: z.coerce.number(),
  totalSupply: z.coerce.number(),
  totalBorrow: z.coerce.number(),
  totalSupplyUsd: z.coerce.number(),
  totalBorrowUsd: z.coerce.number(),
  maxLtv: z.coerce.number().optional(),
});
export type KaminoReserveMetric = z.infer<typeof reserveMetricSchema>;
const reserveMetricsResponse = z.array(reserveMetricSchema);

export function kaminoMetricsUrl(market = KAMINO.mainMarket): string {
  return `${KAMINO.apiBaseUrl}/kamino-market/${market}/reserves/metrics`;
}

export async function fetchKaminoReserveMetrics(fetchImpl?: typeof fetch): Promise<KaminoReserveMetric[]> {
  const raw = await fetchJson(kaminoMetricsUrl(), { upstream: "Kamino API", timeoutMs: 10_000, retries: 2, fetchImpl });
  const parsed = reserveMetricsResponse.safeParse(raw);
  if (!parsed.success) throw new Error("Kamino API returned an unexpected reserve metrics format");
  return parsed.data;
}

/** Sanity bounds: anything outside is treated as bad data, not a real opportunity. */
const MAX_PLAUSIBLE_SUPPLY_APY = 1; // 100%

function lendingRisks(key: KaminoReserveKey, utilization: number, utilizationWarning: number): RiskFactor[] {
  const risks: RiskFactor[] = [
    {
      id: "smart-contract",
      level: "medium",
      title: "Smart-contract risk",
      detail: "Funds are held by the Kamino Lend program. A bug or exploit could cause partial or total loss. SolGoblin has not audited Kamino; check Kamino's published audits yourself.",
    },
    {
      id: "bad-debt",
      level: "medium",
      title: "Borrower default / bad debt",
      detail: "Lenders are exposed to losses if liquidations fail during sharp price moves or oracle failures.",
    },
    {
      id: "variable-rate",
      level: "low",
      title: "Variable rate",
      detail: "Supply APY changes continuously with utilization. Past or current rates do not predict future returns.",
    },
  ];
  if (key === "USDC") {
    risks.push({ id: "stablecoin", level: "medium", title: "Stablecoin risk", detail: "USDC can depeg or be frozen by its issuer. Yield is earned in USDC, not USD." });
  }
  risks.push(
    utilization >= utilizationWarning
      ? { id: "liquidity", level: "high", title: "Withdrawal liquidity is tight", detail: `Reserve utilization is ${(utilization * 100).toFixed(1)}%. Withdrawals can be delayed until borrowers repay or new deposits arrive.` }
      : { id: "liquidity", level: "low", title: "Withdrawal liquidity", detail: `Withdrawals depend on unborrowed liquidity (utilization ${(utilization * 100).toFixed(1)}%). High utilization can temporarily block withdrawals.` },
  );
  return risks;
}

export function kaminoOpportunityFromMetric(
  key: KaminoReserveKey,
  m: KaminoReserveMetric,
  fetchedAt: Date,
  network: SolanaNetwork,
  utilizationWarning = 0.95,
): Opportunity | { error: string } {
  const cfg = KAMINO.reserves[key];
  if (m.reserve !== cfg.address) return { error: `Kamino reserve mismatch for ${key}` };
  if (m.liquidityTokenMint !== cfg.mint) return { error: `Kamino ${key} reserve mint ${m.liquidityTokenMint} does not match expected ${cfg.mint}` };
  if (!Number.isFinite(m.supplyApy) || m.supplyApy < 0 || m.supplyApy > MAX_PLAUSIBLE_SUPPLY_APY) return { error: `Kamino ${key} supply APY ${m.supplyApy} is outside plausible bounds; ignored` };
  const utilization = m.totalSupply > 0 ? Math.min(1, m.totalBorrow / m.totalSupply) : 0;
  const risks = lendingRisks(key, utilization, utilizationWarning);
  const executable = network === "mainnet-beta";
  return {
    id: `kamino-main-${key.toLowerCase()}-supply`,
    protocol: "Kamino Lend",
    strategyName: `${cfg.symbol} supply — Main Market`,
    kind: "lending",
    asset: key,
    network: "mainnet-beta",
    rateType: "lending-supply-apy",
    apy: m.supplyApy,
    apr: null,
    rateNotes: [
      "Variable lending supply APY reported by Kamino; interest only.",
      "Excludes KMNO / farm incentive rewards, which are not tracked by SolGoblin.",
      "Kamino's protocol take rate is already deducted from the supply APY.",
    ],
    source: { kind: "live", name: "Kamino API — reserve metrics", url: kaminoMetricsUrl(), fetchedAt: fetchedAt.toISOString() },
    liquidity: {
      depositDescription: `Deposit ${cfg.symbol} into the Kamino Main Market ${cfg.symbol} reserve (non-borrowing "Vanilla" obligation).`,
      withdrawalDescription: "Withdraw any time, subject to available (unborrowed) reserve liquidity.",
      withdrawalDelayHours: 0,
      minimumDeposit: null,
      minimumDepositNote: "No protocol minimum is documented; tiny deposits are uneconomical because of network fees.",
    },
    costs: {
      entryNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE,
      exitNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE,
      refundableRentLamports: 0,
      protocolFeeRate: 0,
      notes: [
        "A first deposit creates Kamino user accounts and a lookup table; their rent is measured by simulation in the transaction preview.",
        "No deposit or withdrawal fee is charged by Kamino Lend for supplying.",
      ],
    },
    risks,
    riskLevel: risks.some((r) => r.level === "high") ? "high" : "medium",
    executable,
    executableReason: executable ? undefined : "Kamino Lend is only available on mainnet-beta. Switch NEXT_PUBLIC_SOLANA_NETWORK to mainnet-beta to deposit.",
    metrics: { utilization, totalSupplyUsd: m.totalSupplyUsd, totalBorrowUsd: m.totalBorrowUsd, borrowApy: m.borrowApy },
    refs: { market: KAMINO.mainMarket, reserve: cfg.address, mint: cfg.mint },
  };
}

export function createKaminoAdapter(opts: { utilizationWarning?: number; fetchImpl?: typeof fetch } = {}): YieldAdapter {
  return {
    id: "kamino-lend",
    kind: "live",
    async fetchOpportunities(ctx: AdapterContext): Promise<AdapterResult> {
      const errors: string[] = [];
      const opportunities: Opportunity[] = [];
      let metrics: KaminoReserveMetric[];
      try {
        metrics = await fetchKaminoReserveMetrics(opts.fetchImpl);
      } catch (e) {
        return { adapterId: "kamino-lend", opportunities: [], errors: [`Kamino data unavailable: ${e instanceof Error ? e.message : String(e)}`] };
      }
      for (const key of Object.keys(KAMINO.reserves) as KaminoReserveKey[]) {
        const m = metrics.find((r) => r.reserve === KAMINO.reserves[key].address);
        if (!m) {
          errors.push(`Kamino ${key} reserve not found in API response`);
          continue;
        }
        const o = kaminoOpportunityFromMetric(key, m, ctx.now, ctx.network, opts.utilizationWarning);
        if ("error" in o) errors.push(o.error);
        else opportunities.push(o);
      }
      return { adapterId: "kamino-lend", opportunities, errors };
    },
  };
}
