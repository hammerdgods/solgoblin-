import type { AlertRow, PortfolioSnapshotRow, RecommendationRow, Store, StrategySnapshotRow, TransactionEventRow, TxStatus } from "./types";

export interface MemoryTables {
  strategy_snapshots: StrategySnapshotRow[];
  agent_recommendations: RecommendationRow[];
  portfolio_snapshots: PortfolioSnapshotRow[];
  transaction_events: TransactionEventRow[];
  alerts: AlertRow[];
}

export function emptyTables(): MemoryTables {
  return { strategy_snapshots: [], agent_recommendations: [], portfolio_snapshots: [], transaction_events: [], alerts: [] };
}

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);

/** Retention caps so the non-database stores cannot grow without bound. */
const CAPS: Record<keyof MemoryTables, number> = {
  strategy_snapshots: 5000,
  agent_recommendations: 500,
  portfolio_snapshots: 5000,
  transaction_events: 2000,
  alerts: 1000,
};

function cap<K extends keyof MemoryTables>(t: MemoryTables, k: K) {
  const rows = t[k] as { created_at: string }[];
  if (rows.length > CAPS[k]) {
    rows.sort(byCreatedDesc);
    rows.length = CAPS[k];
  }
}

/**
 * In-memory store. Also the base for the file store, which persists `tables`
 * after each write via the `onWrite` hook.
 */
export class MemoryStore implements Store {
  readonly kind: "memory" | "file" = "memory";
  readonly durable: boolean = false;
  constructor(
    protected tables: MemoryTables = emptyTables(),
    private readonly onWrite: (t: MemoryTables) => Promise<void> = async () => {},
  ) {}

  private async write<K extends keyof MemoryTables>(k: K, mutate: (rows: MemoryTables[K]) => void) {
    mutate(this.tables[k]);
    cap(this.tables, k);
    await this.onWrite(this.tables);
  }

  async insertStrategySnapshots(rows: StrategySnapshotRow[]) {
    await this.write("strategy_snapshots", (t) => t.push(...rows));
  }
  async latestStrategySnapshots() {
    const out = new Map<string, StrategySnapshotRow>();
    for (const r of [...this.tables.strategy_snapshots].sort(byCreatedDesc)) if (!out.has(r.opportunity_id)) out.set(r.opportunity_id, r);
    return out;
  }
  async insertRecommendation(row: RecommendationRow) {
    await this.write("agent_recommendations", (t) => t.push(row));
  }
  async listRecommendations({ wallet, limit }: { wallet?: string; limit: number }) {
    return this.tables.agent_recommendations.filter((r) => !wallet || r.wallet === wallet).sort(byCreatedDesc).slice(0, limit);
  }
  async insertPortfolioSnapshot(row: PortfolioSnapshotRow) {
    await this.write("portfolio_snapshots", (t) => t.push(row));
  }
  async listPortfolioSnapshots(wallet: string, limit: number) {
    return this.tables.portfolio_snapshots.filter((r) => r.wallet === wallet).sort(byCreatedDesc).slice(0, limit);
  }
  async upsertTransactionEvent(row: TransactionEventRow) {
    await this.write("transaction_events", (t) => {
      const i = t.findIndex((r) => r.id === row.id);
      if (i >= 0) t[i] = row;
      else t.push(row);
    });
  }
  async transitionTransactionEvent(id: string, from: TxStatus, patch: Partial<TransactionEventRow>) {
    const row = this.tables.transaction_events.find((r) => r.id === id);
    if (!row || row.status !== from) return false;
    Object.assign(row, patch, { id: row.id, updated_at: new Date().toISOString() });
    await this.write("transaction_events", () => {});
    return true;
  }
  async getTransactionEvent(id: string) {
    return this.tables.transaction_events.find((r) => r.id === id) ?? null;
  }
  async listTransactionEvents({ wallet, limit }: { wallet: string; limit: number }) {
    return this.tables.transaction_events.filter((r) => r.wallet === wallet).sort(byCreatedDesc).slice(0, limit);
  }
  async insertAlerts(rows: AlertRow[]) {
    if (rows.length) await this.write("alerts", (t) => t.push(...rows));
  }
  async listAlerts({ wallet, limit }: { wallet?: string; limit: number }) {
    return this.tables.alerts.filter((r) => !wallet || r.wallet === null || r.wallet === wallet).sort(byCreatedDesc).slice(0, limit);
  }
}
