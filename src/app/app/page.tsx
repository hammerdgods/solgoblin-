"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { useConfigStatus } from "@/components/app-shell";
import { OpportunityTable, ScanErrors, useOpportunities } from "@/components/opportunities";
import { PositionReviews, PositionsList, RecentTransactions, usePortfolio } from "@/components/portfolio";
import { useSettings } from "@/components/providers";
import { TxReviewDialog } from "@/components/tx-review";
import { Badge, Button, Card, Notice, Stat } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useApi } from "@/lib/client/api";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import type { AlertRow } from "@/lib/store/types";
import type { Opportunity } from "@/lib/types";
import { grossYieldForPeriod } from "@/lib/yield/math";

const ESTIMATE_DAYS = 30;

export default function Dashboard() {
  const { publicKey, connected } = useWallet();
  const { demoMode, preferences } = useSettings();
  const config = useConfigStatus();
  const wallet = publicKey?.toBase58() ?? null;
  const portfolio = usePortfolio(wallet);
  const view = portfolio.data;
  const opps = useOpportunities();
  const alerts = useApi<{ alerts: AlertRow[] }>(demoMode ? null : `/api/alerts${wallet ? `?wallet=${wallet}` : ""}`, { refreshMs: 120_000 });
  const [review, setReview] = useState<{ o: Opportunity; amount?: number } | null>(null);

  const allOpps = useMemo(() => opps.data?.ranked.map((r) => r.opportunity) ?? [], [opps.data]);

  // Deterministic forward estimate for currently tracked positions at current rates.
  const estimate = useMemo(() => {
    if (!view || !opps.data) return null;
    const out: { SOL: number; USDC: number; covered: number; total: number } = { SOL: 0, USDC: 0, covered: 0, total: 0 };
    if (view.stakeAccounts.ok) {
      for (const a of view.stakeAccounts.data.filter((x) => x.status === "active" || x.status === "activating")) {
        out.total++;
        const o = allOpps.find((x) => x.kind === "native-staking" && x.refs.voteAccount === a.voter) ?? allOpps.find((x) => x.kind === "native-staking");
        if (o && o.apy <= 1) {
          out.SOL += grossYieldForPeriod(a.delegatedSol, o.apy, ESTIMATE_DAYS);
          out.covered++;
        }
      }
    }
    if (view.kamino.ok && view.kamino.data) {
      for (const p of view.kamino.data.positions) {
        out.total++;
        const o = allOpps.find((x) => x.kind === "lending" && x.asset === p.asset);
        if (o) {
          out[p.asset] += grossYieldForPeriod(p.amount, o.apy, ESTIMATE_DAYS);
          out.covered++;
        }
      }
    }
    return out;
  }, [view, opps.data, allOpps]);

  const showWalletPrompt = !demoMode && !connected;
  const prices = view?.prices.quotes;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {demoMode ? "Showing fictional demo data." : wallet ? <>Wallet <span className="font-mono text-text">{shortAddress(wallet, 6)}</span> on {config.data?.network ?? "…"}</> : "Connect a wallet to see balances and positions."}
          </p>
        </div>
        {view && !demoMode && <Button size="sm" onClick={() => { portfolio.refresh(); opps.refresh(); alerts.refresh(); }} disabled={portfolio.loading}>{portfolio.loading ? "Refreshing…" : "Refresh"}</Button>}
      </div>

      {config.data && !config.data.transactionsEnabled && !demoMode && (
        <Notice tone="warn" title="Transactions are currently disabled" action={<Link href="/app/settings" className="text-xs text-accent hover:underline">See checks →</Link>}>
          {config.data.checks.filter((c) => !c.ok && c.id !== "validators").map((c) => c.detail).join(" · ")}. You can still browse data and get recommendations.
        </Notice>
      )}

      {showWalletPrompt && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-medium">Connect your Solana wallet</div>
              <p className="mt-1 max-w-xl text-[13px] text-muted">SolGoblin reads your public balances and positions. It never asks for a seed phrase or private key, and nothing moves without your signature. You can also explore with demo data (toggle “Demo” in the header).</p>
            </div>
            <WalletButton />
          </div>
        </Card>
      )}

      {portfolio.error && <Notice tone="danger" title="Could not load wallet data">{portfolio.error.message}</Notice>}

      {(view || portfolio.loading) && (
        <Card>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Stat label="SOL balance" loading={!view} value={view?.balances.ok ? formatToken(view.balances.data.sol, "SOL") : "—"} hint={view?.balances.ok && prices?.SOL ? formatUsd(view.balances.data.sol * prices.SOL.usd) : view && !view.balances.ok ? "unavailable" : "USD price unavailable"} />
            <Stat label="USDC balance" loading={!view} value={view?.balances.ok ? formatToken(view.balances.data.usdc, "USDC", 2) : "—"} hint={view?.balances.ok && view.balances.data.tokens.length > 1 ? `+${view.balances.data.tokens.length - 1} other token(s)` : undefined} />
            <Stat
              label="Allocated to tracked strategies"
              loading={!view}
              value={view?.totals.allocated ? <><div>{formatToken(view.totals.allocated.SOL, "SOL")}</div><div>{formatToken(view.totals.allocated.USDC, "USDC", 2)}</div></> : "—"}
              hint={view?.totals.allocatedUsd != null ? `≈ ${formatUsd(view.totals.allocatedUsd)} at current prices` : view && !view.totals.allocated ? "A data source is unavailable" : "USD estimate unavailable"}
            />
            <Stat
              label={`Estimated yield, next ${ESTIMATE_DAYS} days`}
              loading={!view || opps.loading}
              value={estimate ? <><div>{formatToken(estimate.SOL, "SOL", 5)}</div><div>{formatToken(estimate.USDC, "USDC", 2)}</div></> : "—"}
              hint={estimate ? `At current rates, assumed constant. Not realized. ${estimate.covered}/${estimate.total} positions priced.` : undefined}
            />
          </div>
          {view && view.balances.ok && view.balances.data.tokens.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {view.balances.data.tokens.slice(0, 8).map((t) => (
                <Badge key={t.mint} title={t.mint}>{formatToken(t.amount, t.symbol ?? shortAddress(t.mint, 3), 4)}{t.program === "token-2022" ? " · T22" : ""}</Badge>
              ))}
            </div>
          )}
          {!demoMode && view && <p className="mt-3 text-[11px] text-faint">Realized rewards are on the <Link href="/app/earnings" className="text-accent hover:underline">Earnings</Link> page. USD values use Kamino&apos;s Scope oracle and are hidden when no fresh price exists.</p>}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {(view || portfolio.loading) && (
            <Card title="Positions" subtitle="Native stake accounts and Kamino Main Market supply">
              <PositionsList view={view} loading={portfolio.loading} />
            </Card>
          )}
          <AgentPanel wallet={wallet} idle={view?.totals.idle ?? null} opportunities={allOpps} onReview={(o, amount) => setReview({ o, amount })} />
          <Card title="Top opportunities" subtitle="For your current settings" action={<Link href="/app/opportunities" className="text-xs text-accent hover:underline">Open scanner →</Link>}>
            <ScanErrors data={opps.data} />
            {opps.error && <Notice tone="danger" title="Opportunities unavailable">{opps.error.message}</Notice>}
            <div className="mt-2">
              <OpportunityTable data={opps.data} loading={opps.loading} compact onSelect={(o) => setReview({ o })} horizonDays={preferences.horizonDays} />
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          {view && view.reviews.length > 0 && (
            <Card title="Position monitor" subtitle="Deterministic checks; never moves funds">
              <PositionReviews view={view} />
            </Card>
          )}
          <Card title="Alerts" action={<Link href="/app/alerts" className="text-xs text-accent hover:underline">All →</Link>}>
            {demoMode ? (
              <p className="text-[13px] text-muted">Alerts are not generated for demo data.</p>
            ) : alerts.data?.alerts.length ? (
              <ul className="space-y-2">
                {alerts.data.alerts.slice(0, 4).map((a) => (
                  <li key={a.id} className="text-[13px]">
                    <Badge tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warn" : "info"}>{a.severity}</Badge> <span className="font-medium">{a.title}</span>
                    <div className="text-[11px] text-faint">{new Date(a.created_at).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{alerts.loading ? "Loading…" : "No alerts recorded yet. Monitoring runs on a schedule or from the Alerts page."}</p>
            )}
          </Card>
          {(view || portfolio.loading) && (
            <Card title="Recent transactions">
              <RecentTransactions view={view} loading={portfolio.loading} />
            </Card>
          )}
        </div>
      </div>

      {review && (
        <TxReviewDialog
          opportunity={review.o}
          defaultAmount={review.amount}
          available={view?.totals.idle ? { SOL: view.totals.idle.SOL ?? 0, USDC: view.totals.idle.USDC ?? 0 } : null}
          onClose={() => setReview(null)}
          onConfirmed={() => {
            portfolio.refresh();
            opps.refresh();
          }}
        />
      )}
    </div>
  );
}
