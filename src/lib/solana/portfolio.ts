import { PublicKey, StakeProgram, type Connection, type ParsedAccountData } from "@solana/web3.js";
import { z } from "zod";
import { KAMINO, LAMPORTS_PER_SOL, MINTS, PROGRAM_IDS, type SolanaNetwork } from "../constants";
import { fetchJson } from "../http/fetchJson";

/** u64::MAX as used by the stake program for "not set" epochs. */
const EPOCH_MAX = "18446744073709551615";

export interface TokenBalance {
  mint: string;
  symbol: string | null;
  amount: number;
  decimals: number;
  program: "spl-token" | "token-2022";
}

export interface WalletBalances {
  lamports: number;
  sol: number;
  usdc: number;
  tokens: TokenBalance[];
}

export async function getWalletBalances(connection: Connection, owner: PublicKey): Promise<WalletBalances> {
  const [lamports, spl, t22] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(PROGRAM_IDS.splToken) }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(PROGRAM_IDS.token2022) }),
  ]);
  const byMint = new Map<string, TokenBalance>();
  const add = (accounts: typeof spl.value, program: TokenBalance["program"]) => {
    for (const a of accounts) {
      const info = (a.account.data as ParsedAccountData).parsed?.info as { mint: string; tokenAmount: { uiAmountString: string; decimals: number } } | undefined;
      if (!info) continue;
      const amount = Number(info.tokenAmount.uiAmountString);
      if (!Number.isFinite(amount)) continue;
      const prev = byMint.get(info.mint);
      if (prev) prev.amount += amount;
      else byMint.set(info.mint, { mint: info.mint, symbol: info.mint === MINTS.USDC ? "USDC" : info.mint === MINTS.wSOL ? "wSOL" : null, amount, decimals: info.tokenAmount.decimals, program });
    }
  };
  add(spl.value, "spl-token");
  add(t22.value, "token-2022");
  const tokens = [...byMint.values()].filter((t) => t.amount > 0).sort((a, b) => Number(b.symbol !== null) - Number(a.symbol !== null) || b.amount - a.amount);
  return { lamports, sol: lamports / LAMPORTS_PER_SOL, usdc: byMint.get(MINTS.USDC)?.amount ?? 0, tokens };
}

export type StakeStatus = "initialized" | "activating" | "active" | "deactivating" | "inactive";

export interface StakeAccountPosition {
  address: string;
  lamports: number;
  /** Delegated stake in SOL (excludes the rent-exempt reserve). */
  delegatedSol: number;
  rentReserveSol: number;
  voter: string | null;
  activationEpoch: number | null;
  deactivationEpoch: number | null;
  status: StakeStatus;
}

/**
 * Approximate status from epochs alone. It ignores network-wide warm-up/cooldown
 * rate limits, which can stretch activation/deactivation across more epochs.
 */
export function stakeStatus(activation: string | null, deactivation: string | null, currentEpoch: number): StakeStatus {
  if (activation === null) return "initialized";
  const act = activation === EPOCH_MAX ? null : Number(activation);
  const deact = deactivation === null || deactivation === EPOCH_MAX ? null : Number(deactivation);
  if (act === null) return "initialized";
  if (deact !== null) return currentEpoch > deact ? "inactive" : "deactivating";
  return currentEpoch > act ? "active" : "activating";
}

interface ParsedStakeInfo {
  meta: { rentExemptReserve: string; authorized: { staker: string; withdrawer: string } };
  stake?: { delegation: { voter: string; stake: string; activationEpoch: string; deactivationEpoch: string } } | null;
}

export async function getStakeAccounts(connection: Connection, owner: PublicKey): Promise<StakeAccountPosition[]> {
  const ownerB58 = owner.toBase58();
  // Offsets in StakeStateV2: staker @12, withdrawer @44.
  const [byStaker, byWithdrawer, epochInfo] = await Promise.all([
    connection.getParsedProgramAccounts(StakeProgram.programId, { filters: [{ dataSize: 200 }, { memcmp: { offset: 12, bytes: ownerB58 } }] }),
    connection.getParsedProgramAccounts(StakeProgram.programId, { filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: ownerB58 } }] }),
    connection.getEpochInfo(),
  ]);
  const seen = new Map<string, (typeof byStaker)[number]>();
  for (const a of [...byStaker, ...byWithdrawer]) seen.set(a.pubkey.toBase58(), a);
  const out: StakeAccountPosition[] = [];
  for (const [address, a] of seen) {
    const data = a.account.data as ParsedAccountData | Buffer;
    if (!("parsed" in data)) continue;
    const info = data.parsed?.info as ParsedStakeInfo | undefined;
    if (!info) continue;
    const d = info.stake?.delegation;
    out.push({
      address,
      lamports: a.account.lamports,
      delegatedSol: d ? Number(d.stake) / LAMPORTS_PER_SOL : 0,
      rentReserveSol: Number(info.meta.rentExemptReserve) / LAMPORTS_PER_SOL,
      voter: d?.voter ?? null,
      activationEpoch: d && d.activationEpoch !== EPOCH_MAX ? Number(d.activationEpoch) : null,
      deactivationEpoch: d && d.deactivationEpoch !== EPOCH_MAX ? Number(d.deactivationEpoch) : null,
      status: stakeStatus(d?.activationEpoch ?? null, d?.deactivationEpoch ?? null, epochInfo.epoch),
    });
  }
  return out.sort((x, y) => y.lamports - x.lamports);
}

export interface StakingRewardRecord {
  stakeAccount: string;
  epoch: number;
  amountSol: number;
  postBalanceSol: number;
  effectiveSlot: number;
}

/**
 * Realized staking rewards, read from the chain via getInflationReward for the last N
 * completed epochs. These are verifiable on-chain values, not estimates.
 */
export async function getRealizedStakingRewards(connection: Connection, stakeAccounts: string[], epochs: number): Promise<{ rewards: StakingRewardRecord[]; epochsChecked: number[]; errors: string[] }> {
  if (stakeAccounts.length === 0) return { rewards: [], epochsChecked: [], errors: [] };
  const { epoch } = await connection.getEpochInfo();
  const keys = stakeAccounts.slice(0, 50).map((a) => new PublicKey(a));
  const targets = Array.from({ length: Math.max(0, Math.min(epochs, 10)) }, (_, i) => epoch - 1 - i).filter((e) => e >= 0);
  const rewards: StakingRewardRecord[] = [];
  const errors: string[] = [];
  // Sequential to stay friendly with public RPC rate limits.
  for (const e of targets) {
    try {
      const res = await connection.getInflationReward(keys, e);
      res.forEach((r, i) => {
        if (r) rewards.push({ stakeAccount: keys[i].toBase58(), epoch: r.epoch, amountSol: r.amount / LAMPORTS_PER_SOL, postBalanceSol: r.postBalance / LAMPORTS_PER_SOL, effectiveSlot: r.effectiveSlot });
      });
    } catch (err) {
      errors.push(`Epoch ${e}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { rewards, epochsChecked: targets, errors };
}

const kaminoDeposit = z.object({ mint: z.string(), symbol: z.string(), amount: z.coerce.number(), value: z.coerce.number(), reserve: z.string() });
const kaminoObligation = z.object({ obligation: z.string(), market: z.string(), tag: z.string(), deposits: z.array(kaminoDeposit), borrows: z.array(z.unknown()) });
const kaminoPortfolio = z.object({ timestamp: z.union([z.string(), z.number()]).optional(), lending: z.array(kaminoObligation).default([]) });

export interface KaminoPosition {
  obligation: string;
  reserve: string;
  asset: "USDC" | "SOL";
  amount: number;
  /** USD value as reported by Kamino (uses Kamino's oracle price). */
  usdValue: number;
  hasBorrows: boolean;
}

/** Positions in the pinned Main Market reserves, from Kamino's documented Portfolio API. */
export async function getKaminoPositions(owner: string, network: SolanaNetwork, fetchImpl?: typeof fetch): Promise<{ positions: KaminoPosition[]; fetchedAt: string; source: string } | null> {
  if (network !== "mainnet-beta") return null;
  const url = `${KAMINO.apiBaseUrl}/portfolio/${owner}`;
  const raw = await fetchJson(url, { upstream: "Kamino Portfolio API", timeoutMs: 12_000, retries: 1, fetchImpl });
  const parsed = kaminoPortfolio.safeParse(raw);
  if (!parsed.success) throw new Error("Kamino Portfolio API returned an unexpected format");
  const positions: KaminoPosition[] = [];
  for (const ob of parsed.data.lending) {
    if (ob.market !== KAMINO.mainMarket) continue;
    for (const d of ob.deposits) {
      const key = (Object.keys(KAMINO.reserves) as (keyof typeof KAMINO.reserves)[]).find((k) => KAMINO.reserves[k].address === d.reserve);
      if (!key) continue;
      positions.push({ obligation: ob.obligation, reserve: d.reserve, asset: key, amount: d.amount, usdValue: d.value, hasBorrows: ob.borrows.length > 0 });
    }
  }
  return { positions, fetchedAt: new Date().toISOString(), source: url };
}

export interface RecentTx {
  signature: string;
  slot: number;
  blockTime: string | null;
  success: boolean;
  memo: string | null;
}

export async function getRecentTransactions(connection: Connection, owner: PublicKey, limit = 10): Promise<RecentTx[]> {
  const sigs = await connection.getSignaturesForAddress(owner, { limit });
  return sigs.map((s) => ({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, success: s.err === null, memo: s.memo ?? null }));
}
