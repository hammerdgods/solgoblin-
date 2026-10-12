import "server-only";
import { PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { getServerConfig } from "../config/server";
import { KAMINO } from "../constants";
import { reviewPositions, type HeldPosition, type PositionReview } from "../agent/review";
import { getUsdPrices, usdMap } from "../prices";
import { rankOpportunities, RISK_PROFILES } from "../scanner/rank";
import {
  getKaminoPositions,
  getRecentTransactions,
  getStakeAccounts,
  getWalletBalances,
  type KaminoPosition,
  type RecentTx,
  type StakeAccountPosition,
  type WalletBalances,
} from "../solana/portfolio";
import type { PortfolioSnapshotRow } from "../store/types";
import type { AssetSymbol, PriceQuote } from "../types";
import { getStore, requireNetwork, scanOpportunities, serverConnection } from "./services";

/** Each section is independent: one failing source never blanks the whole dashboard. */
export type Section<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: string };

async function section<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn(), fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface PortfolioView {
  wallet: string;
  network: string;
  balances: Section<WalletBalances>;
  stakeAccounts: Section<StakeAccountPosition[]>;
  kamino: Section<{ positions: KaminoPosition[]; source: string } | null>;
  recentTransactions: Section<RecentTx[]>;
  prices: { quotes: Partial<Record<AssetSymbol, PriceQuote>>; warnings: string[] };
  reviews: PositionReview[];
  totals: {
    /** Capital in tracked strategies, by asset (asset units). Null when a source failed. */
    allocated: Partial<Record<AssetSymbol, number>> | null;
    /** USD estimate when all inputs and prices are available. */
    allocatedUsd: number | null;
    idle: Partial<Record<AssetSymbol, number>> | null;
  };
}

export function parseWallet(wallet: string): PublicKey {
  try {
    const pk = new PublicKey(wallet);
    if (pk.toBase58() !== wallet) throw new Error("non-canonical");
    return pk;
  } catch {
    throw new Error("Invalid wallet address");
  }
}

export async function getPortfolio(wallet: string): Promise<PortfolioView> {
  const network = requireNetwork();
  const owner = parseWallet(wallet);
  const connection = serverConnection();
  const [balances, stakeAccounts, kamino, recentTransactions, prices] = await Promise.all([
    section(() => getWalletBalances(connection, owner)),
    section(() => getStakeAccounts(connection, owner)),
    section(() => getKaminoPositions(wallet, network)),
    section(() => getRecentTransactions(connection, owner, 10)),
    getUsdPrices(),
  ]);

  let allocated: PortfolioView["totals"]["allocated"] = null;
  let allocatedUsd: number | null = null;
  if (stakeAccounts.ok && kamino.ok) {
    const stakedSol = stakeAccounts.data.reduce((s, a) => s + a.lamports / 1e9, 0);
    const kSol = kamino.data?.positions.filter((p) => p.asset === "SOL").reduce((s, p) => s + p.amount, 0) ?? 0;
    const kUsdc = kamino.data?.positions.filter((p) => p.asset === "USDC").reduce((s, p) => s + p.amount, 0) ?? 0;
    allocated = { SOL: stakedSol + kSol, USDC: kUsdc };
    const sol = prices.prices.SOL?.usd;
    const usdc = prices.prices.USDC?.usd;
    allocatedUsd = sol !== undefined && usdc !== undefined ? allocated.SOL! * sol + allocated.USDC! * usdc : null;
  }
  const idle = balances.ok ? { SOL: balances.data.sol, USDC: balances.data.usdc } : null;

  // Position review against current opportunities (deterministic; never executes anything).
  let reviews: PositionReview[] = [];
  try {
    const scan = await scanOpportunities("live");
    const held: HeldPosition[] = [];
    if (kamino.ok && kamino.data) {
      for (const p of kamino.data.positions) held.push({ id: `kamino-${p.reserve}`, asset: p.asset, amount: p.amount, opportunityId: `kamino-main-${p.asset.toLowerCase()}-supply`, label: `Kamino ${p.asset} supply` });
    }
    if (stakeAccounts.ok) {
      for (const a of stakeAccounts.data.filter((x) => x.voter && (x.status === "active" || x.status === "activating"))) {
        const id = `native-stake-${network}-${a.voter}`;
        held.push({ id: a.address, asset: "SOL", amount: a.delegatedSol, opportunityId: scan.opportunities.some((o) => o.id === id) ? id : null, label: `Stake account ${a.address.slice(0, 4)}…${a.address.slice(-4)}` });
      }
    }
    if (held.length) {
      const cfg = getServerConfig();
      const ranked = rankOpportunities(scan.opportunities, RISK_PROFILES.balanced, { now: new Date(), staleAfterSeconds: cfg.monitoring.staleAfterSeconds, principalByAsset: {}, usdPrices: usdMap(prices.prices) });
      reviews = reviewPositions(held, ranked, { horizonDays: 90, minImprovementBps: cfg.monitoring.apyChangeAlertBps, solUsd: prices.prices.SOL?.usd, assetUsd: usdMap(prices.prices) });
    }
  } catch {
    reviews = [];
  }

  return {
    wallet,
    network,
    balances,
    stakeAccounts,
    kamino: kamino.ok ? { ok: true, fetchedAt: kamino.fetchedAt, data: kamino.data ? { positions: kamino.data.positions, source: kamino.data.source } : null } : kamino,
    recentTransactions,
    prices: { quotes: prices.prices, warnings: prices.warnings },
    reviews,
    totals: { allocated, allocatedUsd, idle },
  };
}

/** Records a snapshot from data the SERVER read itself (clients cannot inject values). */
export async function recordPortfolioSnapshot(wallet: string): Promise<PortfolioSnapshotRow | { skipped: string }> {
  const view = await getPortfolio(wallet);
  if (!view.balances.ok || !view.stakeAccounts.ok || !view.kamino.ok) return { skipped: "One or more data sources were unavailable; snapshot not recorded to avoid a misleading history point." };
  const sol = view.prices.quotes.SOL?.usd ?? null;
  const usdc = view.prices.quotes.USDC?.usd ?? null;
  const positions: PortfolioSnapshotRow["positions"] = [
    ...view.stakeAccounts.data.map((a) => ({ id: a.address, kind: "native-stake" as const, asset: "SOL", amount: a.lamports / 1e9, usd: sol !== null ? (a.lamports / 1e9) * sol : null, label: `Stake ${a.status}` })),
    ...(view.kamino.data?.positions ?? []).map((p) => ({ id: `${p.obligation}:${p.reserve}`, kind: "kamino-lend" as const, asset: p.asset, amount: p.amount, usd: p.usdValue, label: `Kamino ${p.asset} supply (${KAMINO.reserves[p.asset].address.slice(0, 4)}…)` })),
  ];
  const row: PortfolioSnapshotRow = {
    id: randomUUID(),
    wallet,
    network: view.network,
    sol_balance: view.balances.data.sol,
    usdc_balance: view.balances.data.usdc,
    positions,
    sol_usd: sol,
    usdc_usd: usdc,
    created_at: new Date().toISOString(),
  };
  const store = await getStore();
  // Throttle: at most one snapshot per wallet per 10 minutes.
  const [last] = await store.listPortfolioSnapshots(wallet, 1);
  if (last && Date.now() - Date.parse(last.created_at) < 10 * 60_000) return { skipped: "A snapshot was recorded less than 10 minutes ago." };
  await store.insertPortfolioSnapshot(row);
  return row;
}
