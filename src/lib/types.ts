import type { SolanaNetwork } from "./constants";

/**
 * Every number shown to a user carries provenance. `kind: "demo"` data must
 * never be mixed with `kind: "live"` data (see assertNoMixedSources).
 */
export type DataKind = "live" | "demo";

export interface DataSource {
  kind: DataKind;
  /** Human-readable source, e.g. "Kamino API /kamino-market/{market}/reserves/metrics". */
  name: string;
  url?: string;
  /** ISO timestamp of the last successful fetch. */
  fetchedAt: string;
}

export type StrategyKind = "native-staking" | "lending";
export type RateType = "staking-apy" | "lending-supply-apy";
export type RiskLevel = "low" | "medium" | "high";
export type AssetSymbol = "SOL" | "USDC";

export interface RiskFactor {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
}

export interface CostEstimate {
  /** One-off network fee to enter, in lamports (estimate). */
  entryNetworkFeeLamports: number;
  /** One-off network fee to exit, in lamports (estimate). */
  exitNetworkFeeLamports: number;
  /** Refundable rent locked while the position is open, in lamports. */
  refundableRentLamports: number;
  /** Protocol fee charged on deposited amount, as a fraction (0.001 = 0.1%). */
  protocolFeeRate: number;
  notes: string[];
}

export interface LiquidityTerms {
  depositDescription: string;
  withdrawalDescription: string;
  /** Typical time until funds are withdrawable, in hours (0 = instant). */
  withdrawalDelayHours: number;
  minimumDeposit: number | null;
  minimumDepositNote?: string;
}

export interface Opportunity {
  id: string;
  protocol: string;
  strategyName: string;
  kind: StrategyKind;
  asset: AssetSymbol;
  /** Network where the opportunity exists. */
  network: SolanaNetwork;
  rateType: RateType;
  /** Annual percentage yield as a fraction (0.05 = 5%). Never a guarantee. */
  apy: number;
  /** APR as reported or derived; null if not available. */
  apr: number | null;
  /** What the rate includes/excludes. */
  rateNotes: string[];
  source: DataSource;
  liquidity: LiquidityTerms;
  costs: CostEstimate;
  risks: RiskFactor[];
  /** Overall risk tier used by the deterministic ranker. */
  riskLevel: RiskLevel;
  /** Whether SolGoblin can build a deposit transaction for this opportunity on the configured network. */
  executable: boolean;
  executableReason?: string;
  /** Extra metrics that matter to monitoring (utilization, TVL, etc.). */
  metrics: Record<string, number>;
  /** Protocol identifiers needed for transaction building. */
  refs: Record<string, string>;
}

export interface AdapterResult {
  adapterId: string;
  opportunities: Opportunity[];
  errors: string[];
}

export interface YieldAdapter {
  id: string;
  kind: DataKind;
  fetchOpportunities(ctx: AdapterContext): Promise<AdapterResult>;
}

export interface AdapterContext {
  network: SolanaNetwork;
  now: Date;
}

export interface RiskPreferences {
  /** Highest risk tier the user accepts. */
  maxRiskLevel: RiskLevel;
  /** Maximum acceptable withdrawal delay, in hours. */
  maxWithdrawalDelayHours: number;
  allowedAssets: AssetSymbol[];
  /** Position horizon used for net-yield estimates, in days. */
  horizonDays: number;
}

export interface PriceQuote {
  mint: string;
  symbol: string;
  usd: number;
  source: DataSource;
  /** ISO timestamp of the oracle price itself. */
  priceTimestamp: string;
  maxAgeSeconds: number;
}
