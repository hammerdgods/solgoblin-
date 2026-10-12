import { LAMPORTS_PER_SOL, type SolanaNetwork } from "../constants";
import type { Opportunity } from "../types";

/**
 * Pure policy gates for transaction preparation. Every gate that fails is
 * reported so the UI can explain exactly what is blocking execution.
 */

export interface TxPolicyConfig {
  killSwitch: boolean;
  mainnetEnabled: boolean;
  maxDepositSol: number;
  maxDepositUsdc: number;
}

export interface PolicyInput {
  config: TxPolicyConfig;
  network: SolanaNetwork | null;
  rpcNetworkOk: boolean;
  opportunity: Opportunity | null;
  amount: number;
}

export function checkTxPolicy(p: PolicyInput): string[] {
  const blockers: string[] = [];
  if (p.config.killSwitch) blockers.push("Transactions are disabled by the emergency kill switch (TRANSACTIONS_KILL_SWITCH).");
  if (!p.network) blockers.push("The configured network is not supported.");
  if (p.network === "mainnet-beta" && !p.config.mainnetEnabled) blockers.push("Mainnet transactions are disabled by default. An operator must set ENABLE_MAINNET_TRANSACTIONS=true after reviewing the configuration checks.");
  if (!p.rpcNetworkOk) blockers.push("The RPC endpoint does not match the configured network (or is unreachable).");
  if (!p.opportunity) blockers.push("The selected opportunity is not currently available.");
  else {
    if (p.opportunity.source.kind !== "live") blockers.push("Demo opportunities cannot be executed.");
    if (!p.opportunity.executable) blockers.push(p.opportunity.executableReason ?? "This opportunity cannot be executed in the current configuration.");
    if (p.network && p.opportunity.network !== p.network) blockers.push(`This opportunity is on ${p.opportunity.network}, but the app is configured for ${p.network}.`);
    const cap = p.opportunity.asset === "SOL" ? p.config.maxDepositSol : p.config.maxDepositUsdc;
    if (p.amount > cap) blockers.push(`Amount exceeds the per-transaction limit of ${cap} ${p.opportunity.asset} (MAX_DEPOSIT_${p.opportunity.asset}).`);
  }
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) blockers.push("Amount must be greater than zero.");
  return blockers;
}

export interface BalanceCheckInput {
  asset: "SOL" | "USDC";
  amount: number;
  solBalance: number;
  usdcBalance: number;
  /** SOL needed on top of the amount (fees, rent). */
  solOverhead: number;
  minSolReserve: number;
}

export function checkBalances(b: BalanceCheckInput): string[] {
  const problems: string[] = [];
  const fmt = (n: number) => Number(n.toFixed(9)).toString();
  if (b.asset === "SOL") {
    const needed = b.amount + b.solOverhead + b.minSolReserve;
    if (b.solBalance < needed) problems.push(`Insufficient SOL: need ${fmt(needed)} SOL (${fmt(b.amount)} amount + ${fmt(b.solOverhead)} fees/rent + ${fmt(b.minSolReserve)} reserve kept for future fees), wallet has ${fmt(b.solBalance)} SOL.`);
  } else {
    if (b.usdcBalance < b.amount) problems.push(`Insufficient USDC: need ${fmt(b.amount)} USDC, wallet has ${fmt(b.usdcBalance)} USDC.`);
    const needed = b.solOverhead + b.minSolReserve;
    if (b.solBalance < needed) problems.push(`Insufficient SOL for fees: need ${fmt(needed)} SOL (fees/rent + ${fmt(b.minSolReserve)} reserve), wallet has ${fmt(b.solBalance)} SOL.`);
  }
  return problems;
}

/** Upper bound on SOL a Kamino deposit may consume beyond the deposit itself (fees + first-time account rent). */
export const KAMINO_MAX_SOL_OVERHEAD = 0.1;

/** Expected extra SOL for staking: rent reserve + fee. */
export function stakeOverheadSol(rentLamports: number, feeLamports: number): number {
  return (rentLamports + feeLamports) / LAMPORTS_PER_SOL;
}

/** Rate drift between what the user reviewed and the live rate, in bps. */
export function rateChangedBeyond(reviewedApy: number, liveApy: number, toleranceBps: number): boolean {
  return Math.abs(liveApy - reviewedApy) * 10_000 > toleranceBps;
}
