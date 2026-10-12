import "server-only";
import { getRealizedStakingRewards, getKaminoPositions, getStakeAccounts, type StakingRewardRecord } from "../solana/portfolio";
import type { PortfolioSnapshotRow, TransactionEventRow } from "../store/types";
import { parseWallet } from "./portfolio";
import { getStore, requireNetwork, serverConnection } from "./services";

/**
 * Earnings view. Strict provenance rules:
 * - "realized" = verifiable on-chain values only (stake inflation rewards, tx fees).
 * - "estimated" = derived values, always labeled with their limitations.
 * - Yield is reported in the earning asset (SOL / USDC), never as a USD change,
 *   so SOL price movements are not mislabeled as yield.
 */

export interface KaminoAccrualEstimate {
  asset: "SOL" | "USDC";
  currentAmount: number;
  /** Net confirmed deposits made through SolGoblin. */
  recordedNetDeposits: number;
  /** currentAmount − recordedNetDeposits, or null when not computable. */
  estimatedAccrued: number | null;
  note: string;
}

export interface EarningsView {
  wallet: string;
  network: string;
  realized: {
    stakingRewards: { ok: true; totalSol: number; records: StakingRewardRecord[]; epochsChecked: number[]; errors: string[] } | { ok: false; error: string };
    feesPaidLamports: number;
    feesNote: string;
  };
  estimated: { kamino: { ok: true; items: KaminoAccrualEstimate[] } | { ok: false; error: string } };
  flows: { deposits: { asset: string; amount: number; action: string; signature: string | null; at: string }[] };
  events: TransactionEventRow[];
  history: { snapshots: PortfolioSnapshotRow[]; note: string };
  limitations: string[];
}

export function summarizeFlows(events: TransactionEventRow[]) {
  const confirmed = events.filter((e) => e.status === "confirmed");
  const feesPaidLamports = events.reduce((s, e) => s + (e.status === "confirmed" || e.status === "failed" ? e.fee_lamports ?? 0 : 0), 0);
  const deposits = confirmed.map((e) => ({ asset: e.asset, amount: e.amount, action: e.action, signature: e.signature, at: e.updated_at }));
  const kaminoNet: Record<string, number> = {};
  for (const e of confirmed) if (e.action === "kamino-deposit") kaminoNet[e.asset] = (kaminoNet[e.asset] ?? 0) + e.amount;
  return { feesPaidLamports, deposits, kaminoNet };
}

export function estimateKaminoAccrual(asset: "SOL" | "USDC", currentAmount: number, recordedNetDeposits: number): KaminoAccrualEstimate {
  if (recordedNetDeposits <= 0) {
    return { asset, currentAmount, recordedNetDeposits, estimatedAccrued: null, note: "No deposits recorded by SolGoblin for this position, so accrued interest cannot be separated from principal." };
  }
  const diff = currentAmount - recordedNetDeposits;
  if (diff < 0) {
    return { asset, currentAmount, recordedNetDeposits, estimatedAccrued: null, note: "Current balance is below recorded deposits (likely a withdrawal made outside SolGoblin). Accrual cannot be estimated reliably." };
  }
  return { asset, currentAmount, recordedNetDeposits, estimatedAccrued: diff, note: "Estimated as current balance minus deposits confirmed through SolGoblin. Inaccurate if you deposited or withdrew elsewhere." };
}

export async function getEarnings(wallet: string): Promise<EarningsView> {
  const network = requireNetwork();
  const owner = parseWallet(wallet);
  const connection = serverConnection();
  const store = await getStore();
  const [events, snapshots] = await Promise.all([store.listTransactionEvents({ wallet, limit: 200 }), store.listPortfolioSnapshots(wallet, 500)]);
  const flows = summarizeFlows(events);

  let stakingRewards: EarningsView["realized"]["stakingRewards"];
  try {
    const accounts = await getStakeAccounts(connection, owner);
    const r = await getRealizedStakingRewards(connection, accounts.map((a) => a.address), 5);
    stakingRewards = { ok: true, totalSol: r.rewards.reduce((s, x) => s + x.amountSol, 0), records: r.rewards, epochsChecked: r.epochsChecked, errors: r.errors };
  } catch (e) {
    stakingRewards = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let kamino: EarningsView["estimated"]["kamino"];
  try {
    const k = await getKaminoPositions(wallet, network);
    const items: KaminoAccrualEstimate[] = [];
    for (const asset of ["USDC", "SOL"] as const) {
      const current = (k?.positions ?? []).filter((p) => p.asset === asset).reduce((s, p) => s + p.amount, 0);
      const net = flows.kaminoNet[asset] ?? 0;
      if (current > 0 || net > 0) items.push(estimateKaminoAccrual(asset, current, net));
    }
    kamino = { ok: true, items };
  } catch (e) {
    kamino = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return {
    wallet,
    network,
    realized: {
      stakingRewards,
      feesPaidLamports: flows.feesPaidLamports,
      feesNote: "Network fees of transactions submitted through SolGoblin and confirmed on-chain (failed transactions still pay fees).",
    },
    estimated: { kamino },
    flows: { deposits: flows.deposits },
    events,
    history: {
      snapshots: [...snapshots].reverse(),
      note: snapshots.length
        ? "History starts when SolGoblin first recorded this wallet. Values come from server-side on-chain reads; gaps mean no snapshot was taken."
        : "No history yet. SolGoblin records a snapshot when you open the dashboard (at most every 10 minutes) and during monitoring runs.",
    },
    limitations: [
      "Staking rewards cover the last 5 completed epochs for current stake accounts only (RPC getInflationReward).",
      "Kamino interest is estimated, not reported per user by SolGoblin's data sources.",
      "Changes in SOL's USD price are not yield and are excluded from earnings.",
      "APYs are rates, not your realized return.",
    ],
  };
}
