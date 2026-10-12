"use client";

import { useEffect, useMemo, useRef } from "react";
import { postJson, useApi, type FetchState } from "@/lib/client/api";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/client/explorer";
import { formatAge, formatPercent, formatToken, formatUsd, shortAddress } from "@/lib/format";
import type { PortfolioView } from "@/lib/server/portfolio";
import { useNow } from "./data";
import { useSettings } from "./providers";
import { Badge, EmptyState, Notice, Skeleton } from "./ui";

/** Fictional portfolio used only in demo mode. Every field is sample data. */
function demoPortfolio(): PortfolioView {
  const at = new Date().toISOString();
  return {
    wallet: "DemoWa11et1111111111111111111111111111111111",
    network: "demo",
    balances: { ok: true, fetchedAt: at, data: { lamports: 12_400_000_000, sol: 12.4, usdc: 850, tokens: [{ mint: "demo-usdc", symbol: "USDC", amount: 850, decimals: 6, program: "spl-token" }] } },
    stakeAccounts: { ok: true, fetchedAt: at, data: [{ address: "DemoStake111111111111111111111111111111111111", lamports: 5_002_282_880, delegatedSol: 5, rentReserveSol: 0.00228288, voter: "DemoVote11111111111111111111111111111111111", activationEpoch: 1, deactivationEpoch: null, status: "active" }] },
    kamino: { ok: true, fetchedAt: at, data: { positions: [{ obligation: "DemoObligation", reserve: "DemoReserve", asset: "USDC", amount: 1200, usdValue: 1200, hasBorrows: false }], source: "demo" } },
    recentTransactions: { ok: true, fetchedAt: at, data: [] },
    prices: { quotes: {}, warnings: ["Demo mode: no prices are shown."] },
    reviews: [],
    totals: { allocated: { SOL: 5.00228288, USDC: 1200 }, allocatedUsd: null, idle: { SOL: 12.4, USDC: 850 } },
  };
}

const noop = () => {};

export function usePortfolio(wallet: string | null): FetchState<PortfolioView> {
  const { demoMode } = useSettings();
  const live = useApi<PortfolioView>(!demoMode && wallet ? `/api/portfolio?wallet=${wallet}` : null, { refreshMs: 60_000 });
  const snapshotFor = useRef<string | null>(null);
  // Built only when demo mode is on (never during prerender), so no time value is baked into HTML.
  const demo = useMemo(() => (demoMode ? demoPortfolio() : null), [demoMode]);

  // Record a server-side snapshot once per wallet per session (server throttles further).
  useEffect(() => {
    if (demoMode || !wallet || !live.data || snapshotFor.current === wallet) return;
    snapshotFor.current = wallet;
    postJson("/api/portfolio/snapshot", { wallet }).catch(() => {});
  }, [demoMode, wallet, live.data]);

  if (demoMode) return { data: demo, error: null, loading: false, refresh: noop, updatedAt: null };
  return live;
}

function SectionError({ what, error }: { what: string; error: string }) {
  return <Notice tone="warn" title={`${what} unavailable`}>{error}</Notice>;
}

export function PositionsList({ view, loading }: { view: PortfolioView | null; loading: boolean }) {
  const now = useNow();
  if (loading && !view) return <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!view) return null;
  const solPrice = view.prices.quotes.SOL?.usd;
  const stake = view.stakeAccounts;
  const kamino = view.kamino;
  const empty = stake.ok && kamino.ok && stake.data.length === 0 && (kamino.data?.positions.length ?? 0) === 0;
  return (
    <div className="space-y-3">
      {!stake.ok && <SectionError what="Stake accounts" error={stake.error} />}
      {!kamino.ok && <SectionError what="Kamino positions" error={kamino.error} />}
      {empty && <EmptyState title="No tracked positions yet">SolGoblin tracks native stake accounts and Kamino Main Market supply positions for this wallet. Pick an opportunity to get started.</EmptyState>}
      <ul className="divide-y divide-border/70">
        {stake.ok && stake.data.map((a) => (
          <li key={a.address} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                Native stake
                <Badge tone={a.status === "active" ? "accent" : a.status === "activating" || a.status === "deactivating" ? "info" : "neutral"}>{a.status}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {view.network !== "demo" ? <a className="hover:text-text" href={explorerAddressUrl(a.address)} target="_blank" rel="noreferrer">{shortAddress(a.address)}</a> : "demo account"}
                {a.voter && <> · validator {shortAddress(a.voter)}</>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums">{formatToken(a.lamports / 1e9, "SOL")}</div>
              <div className="text-[11px] text-faint">{formatToken(a.delegatedSol, "SOL")} delegated{solPrice ? ` · ${formatUsd((a.lamports / 1e9) * solPrice)}` : ""}</div>
            </div>
          </li>
        ))}
        {kamino.ok && kamino.data?.positions.map((p) => (
          <li key={p.obligation + p.reserve} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">Kamino {p.asset} supply {p.hasBorrows && <Badge tone="warn" title="This obligation also has borrows; SolGoblin does not manage borrowing.">has borrows</Badge>}</div>
              <div className="mt-0.5 text-xs text-muted">Main Market · obligation {shortAddress(p.obligation)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums">{formatToken(p.amount, p.asset)}</div>
              <div className="text-[11px] text-faint">{view.network === "demo" ? "demo" : `${formatUsd(p.usdValue)} (Kamino valuation)`}</div>
            </div>
          </li>
        ))}
      </ul>
      {kamino.ok && kamino.data === null && <p className="text-[11px] text-faint">Kamino positions are only read on mainnet-beta.</p>}
      {stake.ok && <p className="text-[11px] text-faint">Stake status is approximate (epoch-based; ignores network-wide warm-up/cool-down limits). Updated {formatAge(stake.fetchedAt, now)}.</p>}
    </div>
  );
}

export function RecentTransactions({ view, loading }: { view: PortfolioView | null; loading: boolean }) {
  if (loading && !view) return <Skeleton className="h-24 w-full" />;
  if (!view) return null;
  const r = view.recentTransactions;
  if (!r.ok) return <SectionError what="Recent transactions" error={r.error} />;
  if (r.data.length === 0) return <EmptyState title="No recent transactions">{view.network === "demo" ? "Demo mode does not show transactions." : "This wallet has no transactions on this network yet."}</EmptyState>;
  return (
    <ul className="divide-y divide-border/70 text-sm">
      {r.data.map((t) => (
        <li key={t.signature} className="flex items-center justify-between gap-3 py-2">
          <a className="font-mono text-xs text-muted hover:text-text" href={explorerTxUrl(t.signature)} target="_blank" rel="noreferrer">{shortAddress(t.signature, 6)} ↗</a>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-faint">{t.blockTime ? new Date(t.blockTime).toLocaleString() : `slot ${t.slot}`}</span>
            <Badge tone={t.success ? "neutral" : "danger"}>{t.success ? "ok" : "failed"}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PositionReviews({ view }: { view: PortfolioView | null }) {
  if (!view || view.reviews.length === 0) return null;
  return (
    <ul className="space-y-2">
      {view.reviews.map((r) => (
        <li key={r.positionId} className="rounded-lg border border-border p-3 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{r.label}</span>
            <Badge tone={r.verdict === "review" ? "warn" : "accent"}>{r.verdict === "review" ? "Review suggested" : "Keep"}</Badge>
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          {r.alternative && r.current && r.alternative.apy > r.current.apy && (
            <div className="mt-1 text-[11px] text-faint">Alternative: {r.alternative.strategyName} ({formatPercent(r.alternative.apy)}). SolGoblin never moves funds automatically.</div>
          )}
        </li>
      ))}
    </ul>
  );
}
