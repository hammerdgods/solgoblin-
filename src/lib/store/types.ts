import type { DataKind } from "../types";

export interface StrategySnapshotRow {
  id: string;
  opportunity_id: string;
  protocol: string;
  asset: string;
  network: string;
  rate_type: string;
  apy: number;
  source_kind: DataKind;
  source_name: string;
  fetched_at: string;
  metrics: Record<string, number>;
  created_at: string;
}

export interface RecommendationRow {
  id: string;
  wallet: string | null;
  mode: DataKind;
  engine: "deterministic" | "ai-assisted";
  record: unknown;
  created_at: string;
}

export interface PortfolioPositionSnapshot {
  id: string;
  kind: "native-stake" | "kamino-lend";
  asset: string;
  /** Amount in asset units, from on-chain / protocol data. */
  amount: number;
  /** USD value if a reliable price existed at snapshot time. */
  usd: number | null;
  label: string;
}

export interface PortfolioSnapshotRow {
  id: string;
  wallet: string;
  network: string;
  sol_balance: number;
  usdc_balance: number;
  positions: PortfolioPositionSnapshot[];
  sol_usd: number | null;
  usdc_usd: number | null;
  created_at: string;
}

export type TxStatus = "prepared" | "submitted" | "confirmed" | "failed" | "expired";
export type TxAction = "kamino-deposit" | "native-stake";

export interface TransactionEventRow {
  id: string;
  wallet: string;
  network: string;
  opportunity_id: string;
  action: TxAction;
  asset: string;
  amount: number;
  status: TxStatus;
  signature: string | null;
  fee_lamports: number | null;
  message_hash: string;
  last_valid_block_height: number;
  error: string | null;
  /** Extra details (stake account address, reserve, etc.). */
  details: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRow {
  id: string;
  type: "apy-change" | "stale-data" | "liquidity" | "validator" | "data-unavailable" | "position-review";
  severity: AlertSeverity;
  title: string;
  detail: string;
  opportunity_id: string | null;
  wallet: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Store {
  readonly kind: "supabase" | "file" | "memory";
  readonly durable: boolean;
  insertStrategySnapshots(rows: StrategySnapshotRow[]): Promise<void>;
  /** Most recent snapshot per opportunity id. */
  latestStrategySnapshots(): Promise<Map<string, StrategySnapshotRow>>;
  insertRecommendation(row: RecommendationRow): Promise<void>;
  listRecommendations(opts: { wallet?: string; limit: number }): Promise<RecommendationRow[]>;
  insertPortfolioSnapshot(row: PortfolioSnapshotRow): Promise<void>;
  listPortfolioSnapshots(wallet: string, limit: number): Promise<PortfolioSnapshotRow[]>;
  upsertTransactionEvent(row: TransactionEventRow): Promise<void>;
  /**
   * Atomic compare-and-set on status. Returns false (and changes nothing) if the
   * row's current status is not `from`. Used to prevent duplicate submission.
   */
  transitionTransactionEvent(id: string, from: TxStatus, patch: Partial<TransactionEventRow>): Promise<boolean>;
  getTransactionEvent(id: string): Promise<TransactionEventRow | null>;
  listTransactionEvents(opts: { wallet: string; limit: number }): Promise<TransactionEventRow[]>;
  insertAlerts(rows: AlertRow[]): Promise<void>;
  listAlerts(opts: { wallet?: string; limit: number }): Promise<AlertRow[]>;
}
