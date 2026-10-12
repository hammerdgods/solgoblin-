"use client";

import { Fragment, useState } from "react";
import { useApi } from "@/lib/client/api";
import { formatDuration, formatPercent, formatToken } from "@/lib/format";
import type { RankedOpportunity } from "@/lib/scanner/rank";
import type { AssetSymbol, Opportunity, PriceQuote } from "@/lib/types";
import { LAMPORTS_PER_SOL } from "@/lib/constants";
import { SourceTag } from "./data";
import { useSettings } from "./providers";
import { Badge, Button, cx, EmptyState, KeyValue, Notice, Skeleton } from "./ui";

export interface OpportunitiesResponse {
  scan: { mode: "live" | "demo"; network: string; scannedAt: string; errors: { adapterId: string; message: string }[] };
  ranked: RankedOpportunity[];
  prices: { quotes: Partial<Record<AssetSymbol, PriceQuote>>; warnings: string[] };
  staleAfterSeconds: number;
}

export function useOpportunities(amounts: { SOL?: number; USDC?: number } = {}) {
  const { demoMode, preferences } = useSettings();
  const qs = new URLSearchParams({
    mode: demoMode ? "demo" : "live",
    maxRisk: preferences.maxRiskLevel,
    maxDelayHours: String(preferences.maxWithdrawalDelayHours),
    horizonDays: String(preferences.horizonDays),
    sol: String(amounts.SOL ?? 0),
    usdc: String(amounts.USDC ?? 0),
  });
  return useApi<OpportunitiesResponse>(`/api/opportunities?${qs}`, { refreshMs: 60_000 });
}

const riskTone = (l: string) => (l === "high" ? "danger" : l === "medium" ? "warn" : "neutral") as "danger" | "warn" | "neutral";

export function RateCell({ o }: { o: Opportunity }) {
  return (
    <div>
      <div className="font-semibold tabular-nums">{o.apy >= 0 && o.apy <= 1 ? formatPercent(o.apy, 2) : "n/a"}</div>
      <div className="text-[11px] text-faint">{o.rateType === "staking-apy" ? "est. staking APY" : "lending supply APY"}</div>
    </div>
  );
}

export function OpportunityTable({ data, loading, onSelect, compact = false, horizonDays }: { data: OpportunitiesResponse | null; loading: boolean; onSelect?: (o: Opportunity) => void; compact?: boolean; horizonDays: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (!data) return null;
  const rows = compact ? data.ranked.filter((r) => r.eligible).slice(0, 3) : data.ranked;
  if (rows.length === 0) {
    return <EmptyState title="No opportunities to show">{data.scan.errors.length ? "Data sources are unavailable right now." : "Nothing matches your current risk and liquidity settings. Adjust them in Settings."}</EmptyState>;
  }
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-faint">
          <tr className="border-b border-border">
            <th className="px-4 py-2 font-medium sm:px-2">Strategy</th>
            <th className="px-2 py-2 font-medium">Rate</th>
            <th className="px-2 py-2 font-medium">Risk</th>
            <th className="px-2 py-2 font-medium">Withdrawal</th>
            <th className="px-2 py-2 font-medium">Score</th>
            <th className="px-2 py-2 font-medium">Source</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const o = r.opportunity;
            const isOpen = open === o.id;
            return (
              <Fragment key={o.id}>
                <tr className={cx("border-b border-border/60 align-top", !r.eligible && "opacity-60")}>
                  <td className="px-4 py-3 sm:px-2">
                    <div className="flex items-center gap-2">
                      {r.eligible && i === 0 && <Badge tone="accent">Top match</Badge>}
                      <span className="font-medium">{o.strategyName}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{o.protocol} · {o.asset} · {o.network}</div>
                    {!r.eligible && <div className="mt-1 text-xs text-warn">Excluded: {r.exclusionReasons.join(" ")}</div>}
                    {r.eligible && !o.executable && <div className="mt-1 text-xs text-faint">View only: {o.executableReason}</div>}
                  </td>
                  <td className="px-2 py-3"><RateCell o={o} /></td>
                  <td className="px-2 py-3"><Badge tone={riskTone(o.riskLevel)}>{o.riskLevel}</Badge></td>
                  <td className="px-2 py-3 text-xs text-muted">{o.liquidity.withdrawalDelayHours > 0 ? formatDuration(o.liquidity.withdrawalDelayHours) : "Instant*"}</td>
                  <td className="px-2 py-3 tabular-nums text-xs" title="Fee-adjusted rate − risk penalty − liquidity penalty">{formatPercent(r.score.score, 2)}</td>
                  <td className="px-2 py-3"><SourceTag source={o.source} staleAfterSeconds={data.staleAfterSeconds} /></td>
                  <td className="px-2 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen}>{isOpen ? "Hide" : "Details"}</Button>
                      {onSelect && <Button size="sm" variant={o.executable && r.eligible ? "primary" : "secondary"} disabled={o.source.kind === "demo" || !o.executable} onClick={() => onSelect(o)}>Deposit</Button>}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-bg/40">
                    <td colSpan={7} className="px-4 py-4 sm:px-3">
                      <OpportunityDetails r={r} horizonDays={horizonDays} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!compact && <p className="mt-2 px-4 text-[11px] text-faint sm:px-0">* Lending withdrawals are instant only when the reserve has unborrowed liquidity.</p>}
    </div>
  );
}

export function OpportunityDetails({ r, horizonDays }: { r: RankedOpportunity; horizonDays: number }) {
  const o = r.opportunity;
  const ny = r.netYield;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <KeyValue
          items={[
            { k: "Rate type", v: o.rateType === "staking-apy" ? "Staking (estimated)" : "Lending supply" },
            { k: "APY", v: formatPercent(o.apy, 3) },
            ...(o.apr !== null ? [{ k: "APR", v: formatPercent(o.apr, 3) }] : []),
            ...(o.metrics.utilization !== undefined ? [{ k: "Utilization", v: formatPercent(o.metrics.utilization, 1) }] : []),
            ...(o.metrics.commission !== undefined ? [{ k: "Validator commission", v: formatPercent(o.metrics.commission, 1) }] : []),
            { k: "Minimum deposit", v: o.liquidity.minimumDeposit !== null ? formatToken(o.liquidity.minimumDeposit, o.asset) : "None documented" },
            { k: "Entry + exit network fees", v: formatToken((o.costs.entryNetworkFeeLamports + o.costs.exitNetworkFeeLamports) / LAMPORTS_PER_SOL, "SOL", 6) },
            { k: "Refundable rent", v: o.costs.refundableRentLamports ? formatToken(o.costs.refundableRentLamports / LAMPORTS_PER_SOL, "SOL", 6) : "—" },
            { k: "Protocol fee", v: formatPercent(o.costs.protocolFeeRate, 2) },
          ]}
        />
        {r.principal > 0 && (
          <div className="rounded-lg border border-border p-3 text-[13px]">
            <div className="text-xs font-medium text-muted">Estimate for {formatToken(r.principal, o.asset)} over {horizonDays} days (assumes constant rate)</div>
            <div className="mt-1.5 grid grid-cols-2 gap-2 tabular-nums">
              <span className="text-muted">Gross yield</span><span className="text-right">{formatToken(ny.grossYield, o.asset, 6)}</span>
              <span className="text-muted">Fees</span><span className="text-right">−{formatToken(ny.networkFees + ny.protocolFee, o.asset, 6)}</span>
              <span className="text-muted">Net estimate</span><span className="text-right font-medium">{formatToken(ny.netYield, o.asset, 6)}</span>
              <span className="text-muted">Break-even</span><span className="text-right">{ny.breakEvenDays !== null ? `${ny.breakEvenDays.toFixed(1)} days` : "never at this rate"}</span>
            </div>
          </div>
        )}
        <div className="text-[13px]">
          <div className="text-xs font-medium text-muted">Score breakdown</div>
          <div className="mt-1 font-mono text-xs text-muted">
            {formatPercent(r.score.effectiveAnnualRate, 2)} fee-adjusted − {formatPercent(r.score.riskPenalty, 2)} risk − {formatPercent(r.score.liquidityPenalty, 2)} liquidity = <span className="text-text">{formatPercent(r.score.score, 2)}</span>
          </div>
        </div>
      </div>
      <div className="space-y-3 text-[13px]">
        <div>
          <div className="text-xs font-medium text-muted">Deposit / withdrawal</div>
          <p className="mt-1">{o.liquidity.depositDescription}</p>
          <p className="mt-1 text-muted">{o.liquidity.withdrawalDescription}</p>
        </div>
        <div>
          <div className="text-xs font-medium text-muted">About this rate</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">{o.rateNotes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <div>
          <div className="text-xs font-medium text-muted">Risks</div>
          <ul className="mt-1 space-y-1">
            {o.risks.map((k) => (
              <li key={k.id}><Badge tone={riskTone(k.level)}>{k.level}</Badge> <span className="font-medium">{k.title}.</span> <span className="text-muted">{k.detail}</span></li>
            ))}
          </ul>
        </div>
        {r.warnings.length > 0 && r.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        <div className="text-[11px] text-faint">Source: {o.source.name}{o.source.url ? ` (${o.source.url})` : ""} · fetched {new Date(o.source.fetchedAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

export function ScanErrors({ data }: { data: OpportunitiesResponse | null }) {
  if (!data || (data.scan.errors.length === 0 && data.prices.warnings.length === 0)) return null;
  return (
    <Notice tone="warn" title="Some data is unavailable">
      <ul className="list-disc space-y-0.5 pl-4">
        {data.scan.errors.map((e) => <li key={e.adapterId + e.message}>{e.message}</li>)}
        {data.prices.warnings.map((w) => <li key={w}>{w} USD values are hidden where prices are missing.</li>)}
      </ul>
    </Notice>
  );
}
