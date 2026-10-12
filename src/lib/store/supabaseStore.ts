import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlertRow, PortfolioSnapshotRow, RecommendationRow, Store, StrategySnapshotRow, TransactionEventRow, TxStatus } from "./types";

/**
 * Supabase-backed store. Uses the service-role key SERVER-SIDE ONLY: there is no
 * end-user auth (wallets are not Supabase users), so tables have RLS enabled with
 * no anon policies and only the server can read/write. See supabase/migrations.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  readonly durable = true;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private check<T>(res: { data: T; error: { message: string } | null }, op: string): T {
    if (res.error) throw new Error(`Supabase ${op} failed: ${res.error.message}`);
    return res.data;
  }

  async insertStrategySnapshots(rows: StrategySnapshotRow[]) {
    if (rows.length) this.check(await this.db.from("strategy_snapshots").insert(rows), "insert strategy_snapshots");
  }
  async latestStrategySnapshots() {
    const data = this.check(await this.db.from("latest_strategy_snapshots").select("*"), "select latest_strategy_snapshots") as StrategySnapshotRow[];
    return new Map(data.map((r) => [r.opportunity_id, r]));
  }
  async insertRecommendation(row: RecommendationRow) {
    this.check(await this.db.from("agent_recommendations").insert(row), "insert agent_recommendations");
  }
  async listRecommendations({ wallet, limit }: { wallet?: string; limit: number }) {
    let q = this.db.from("agent_recommendations").select("*").order("created_at", { ascending: false }).limit(limit);
    if (wallet) q = q.eq("wallet", wallet);
    return this.check(await q, "select agent_recommendations") as RecommendationRow[];
  }
  async insertPortfolioSnapshot(row: PortfolioSnapshotRow) {
    this.check(await this.db.from("portfolio_snapshots").insert(row), "insert portfolio_snapshots");
  }
  async listPortfolioSnapshots(wallet: string, limit: number) {
    return this.check(await this.db.from("portfolio_snapshots").select("*").eq("wallet", wallet).order("created_at", { ascending: false }).limit(limit), "select portfolio_snapshots") as PortfolioSnapshotRow[];
  }
  async upsertTransactionEvent(row: TransactionEventRow) {
    this.check(await this.db.from("transaction_events").upsert(row, { onConflict: "id" }), "upsert transaction_events");
  }
  async transitionTransactionEvent(id: string, from: TxStatus, patch: Partial<TransactionEventRow>) {
    const { id: _ignored, ...rest } = patch;
    void _ignored;
    const data = this.check(
      await this.db.from("transaction_events").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id).eq("status", from).select("id"),
      "transition transaction_events",
    ) as { id: string }[];
    return data.length === 1;
  }
  async getTransactionEvent(id: string) {
    const data = this.check(await this.db.from("transaction_events").select("*").eq("id", id).maybeSingle(), "select transaction_events");
    return (data as TransactionEventRow | null) ?? null;
  }
  async listTransactionEvents({ wallet, limit }: { wallet: string; limit: number }) {
    return this.check(await this.db.from("transaction_events").select("*").eq("wallet", wallet).order("created_at", { ascending: false }).limit(limit), "select transaction_events") as TransactionEventRow[];
  }
  async insertAlerts(rows: AlertRow[]) {
    if (rows.length) this.check(await this.db.from("alerts").insert(rows), "insert alerts");
  }
  async listAlerts({ wallet, limit }: { wallet?: string; limit: number }) {
    let q = this.db.from("alerts").select("*").order("created_at", { ascending: false }).limit(limit);
    if (wallet) {
      // Interpolated into a PostgREST filter: only base58 characters may pass.
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error("invalid wallet address");
      q = q.or(`wallet.is.null,wallet.eq.${wallet}`);
    }
    return this.check(await q, "select alerts") as AlertRow[];
  }
}
