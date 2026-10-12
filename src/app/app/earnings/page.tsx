"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo, useState } from "react";
import { HistoryChart, type HistoryPoint } from "@/components/history-chart";
import { useSettings } from "@/components/providers";
import { Badge, Button, Card, EmptyState, KeyValue, Notice, Skeleton, Stat } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useApi } from "@/lib/client/api";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/client/explorer";
import { LAMPORTS_PER_SOL } from "@/lib/constants";
import { formatToken, shortAddress } from "@/lib/format";
import type { EarningsView } from "@/lib/server/earnings";

export default function EarningsPage() {
  const { publicKey } = useWallet();
  const { demoMode } = useSettings();
  const wallet = publicKey?.toBase58() ?? null;
  const earnings = useApi<EarningsView>(!demoMode && wallet ? `/api/earnings?wallet=${wallet}` : null);
  const [showTable, setShowTable] = useState(false);
  const e = earnings.data;

  const series = useMemo(() => {
    const sol: HistoryPoint[] = [];
    const usdc: HistoryPoint[] = [];
    for (const s of e?.history.snapshots ?? []) {
      const t = Date.parse(s.created_at);
      sol.push({ t, value: s.positions.filter((p) => p.asset === "SOL").reduce((a, p) => a + p.amount, 0) });
      usdc.push({ t, value: s.positions.filter((p) => p.asset === "USDC").reduce((a, p) => a + p.amount, 0) });
    }
    return { sol, usdc };
  }, [e]);

  if (demoMode) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Earnings</h1>
        <Notice tone="demo" title="Not available in demo mode">The earnings tracker only shows verifiable on-chain data and records for a real wallet. SolGoblin does not fabricate demo profits.</Notice>
      </div>
    );
  }
  if (!wallet) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Earnings</h1>
        <EmptyState title="Connect a wallet to track earnings" action={<WalletButton />}>Earnings are computed from on-chain staking rewards, confirmed transactions, and position snapshots for your wallet.</EmptyState>
      </div>
    );
  }

  const rewards = e?.realized.stakingRewards;
  const kamino = e?.estimated.kamino;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Earnings</h1>
          <p className="mt-1 text-sm text-muted">Realized values come from the chain. Estimates are labeled. SOL price changes are never counted as yield.</p>
        </div>
        <Button size="sm" onClick={earnings.refresh} disabled={earnings.loading}>{earnings.loading ? "Loading…" : "Refresh"}</Button>
      </div>
      {earnings.error && <Notice tone="danger" title="Could not load earnings">{earnings.error.message}</Notice>}

      <Card>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Realized staking rewards" loading={!e} value={rewards?.ok ? formatToken(rewards.totalSol, "SOL", 6) : "—"} hint={rewards?.ok ? `Last ${rewards.epochsChecked.length} epochs, on-chain` : rewards ? "unavailable" : undefined} />
          <Stat label="Est. Kamino interest" loading={!e} value={kamino?.ok ? kamino.items.filter((i) => i.estimatedAccrued !== null).map((i) => formatToken(i.estimatedAccrued, i.asset, 6)).join(" · ") || "—" : "—"} hint="Estimate; see notes" />
          <Stat label="Network fees paid" loading={!e} value={e ? formatToken(e.realized.feesPaidLamports / LAMPORTS_PER_SOL, "SOL", 6) : "—"} hint="Via SolGoblin, on-chain" />
          <Stat label="Deposits via SolGoblin" loading={!e} value={e ? String(e.flows.deposits.length) : "—"} hint="Confirmed only" />
        </div>
        {e && rewards?.ok && (
          <p className="mt-4 text-[13px] text-muted">
            Net in SOL over the checked window: <span className="tabular-nums text-text">{formatToken(rewards.totalSol - e.realized.feesPaidLamports / LAMPORTS_PER_SOL, "SOL", 6)}</span> (staking rewards minus fees paid through SolGoblin). USDC interest is tracked separately and never converted.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="SOL in tracked positions" subtitle="Stake accounts + Kamino SOL supply, in SOL">
          {!e ? <Skeleton className="h-44 w-full" /> : series.sol.length >= 2 ? <HistoryChart points={series.sol} asset="SOL" /> : <EmptyState title="Not enough history yet">{e.history.note}</EmptyState>}
        </Card>
        <Card title="USDC in tracked positions" subtitle="Kamino USDC supply, in USDC">
          {!e ? <Skeleton className="h-44 w-full" /> : series.usdc.length >= 2 ? <HistoryChart points={series.usdc} asset="USDC" /> : <EmptyState title="Not enough history yet">{e.history.note}</EmptyState>}
        </Card>
      </div>
      {e && e.history.snapshots.length > 0 && <p className="-mt-2 text-[11px] text-faint">{e.history.note} Changes include deposits and withdrawals, not just yield.</p>}

      <Card title="Staking rewards by epoch" subtitle="getInflationReward for your current stake accounts" action={rewards?.ok && rewards.records.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide table" : "Show table"}</Button> : undefined}>
        {!e ? <Skeleton className="h-20 w-full" /> : !rewards?.ok ? (
          <Notice tone="warn" title="Staking rewards unavailable">{rewards?.ok === false ? rewards.error : ""}</Notice>
        ) : rewards.records.length === 0 ? (
          <EmptyState title="No staking rewards in the checked epochs">Rewards are paid at epoch boundaries once stake is active. Newly delegated stake earns nothing until it activates.</EmptyState>
        ) : (
          <>
            <ul className="space-y-1.5">
              {Object.entries(rewards.records.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.epoch]: (acc[r.epoch] ?? 0) + r.amountSol }), {}))
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([epoch, amt], _i, arr) => {
                  const max = Math.max(...arr.map((x) => x[1]));
                  return (
                    <li key={epoch} className="flex items-center gap-3 text-[13px]">
                      <span className="w-20 shrink-0 text-muted">Epoch {epoch}</span>
                      <span className="h-2 rounded-r bg-[#2fa866]" style={{ width: `${Math.max(2, (amt / max) * 60)}%` }} />
                      <span className="tabular-nums">{formatToken(amt, "SOL", 6)}</span>
                    </li>
                  );
                })}
            </ul>
            {showTable && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wider text-faint"><tr><th className="py-1.5">Epoch</th><th>Stake account</th><th className="text-right">Reward</th><th className="text-right">Post balance</th></tr></thead>
                  <tbody>
                    {rewards.records.map((r) => (
                      <tr key={`${r.epoch}-${r.stakeAccount}`} className="border-t border-border/60">
                        <td className="py-1.5">{r.epoch}</td>
                        <td><a className="font-mono text-xs text-muted hover:text-text" href={explorerAddressUrl(r.stakeAccount)} target="_blank" rel="noreferrer">{shortAddress(r.stakeAccount)}</a></td>
                        <td className="text-right tabular-nums">{formatToken(r.amountSol, "SOL", 9)}</td>
                        <td className="text-right tabular-nums">{formatToken(r.postBalanceSol, "SOL", 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rewards.errors.length > 0 && <p className="mt-2 text-[11px] text-warn">Some epochs could not be read: {rewards.errors.join("; ")}</p>}
          </>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Kamino interest (estimated)">
          {!e ? <Skeleton className="h-16 w-full" /> : !kamino?.ok ? <Notice tone="warn" title="Kamino data unavailable">{kamino?.ok === false ? kamino.error : ""}</Notice> : kamino.items.length === 0 ? (
            <EmptyState title="No Kamino positions">{e.network === "mainnet-beta" ? "No Kamino Main Market supply positions found for this wallet." : "Kamino is only tracked on mainnet-beta."}</EmptyState>
          ) : (
            <div className="space-y-3">
              {kamino.items.map((i) => (
                <div key={i.asset} className="space-y-2">
                  <KeyValue items={[
                    { k: `Current ${i.asset} supplied`, v: formatToken(i.currentAmount, i.asset, 6) },
                    { k: "Net deposits via SolGoblin", v: formatToken(i.recordedNetDeposits, i.asset, 6) },
                    { k: "Estimated accrued interest", v: i.estimatedAccrued !== null ? formatToken(i.estimatedAccrued, i.asset, 6) : "Not computable" },
                  ]} />
                  <p className="text-[11px] text-faint">{i.note}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Deposits & transactions via SolGoblin">
          {!e ? <Skeleton className="h-16 w-full" /> : e.events.length === 0 ? <EmptyState title="No transactions yet">Transactions you approve through SolGoblin appear here with their on-chain status.</EmptyState> : (
            <ul className="divide-y divide-border/70 text-[13px]">
              {e.events.slice(0, 15).map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <div>{ev.action === "native-stake" ? "Stake" : "Kamino supply"} {formatToken(ev.amount, ev.asset, 6)}</div>
                    <div className="text-[11px] text-faint">{new Date(ev.created_at).toLocaleString()}{ev.fee_lamports ? ` · fee ${formatToken(ev.fee_lamports / LAMPORTS_PER_SOL, "SOL", 9)}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.signature && <a className="font-mono text-[11px] text-muted hover:text-text" href={explorerTxUrl(ev.signature)} target="_blank" rel="noreferrer">{shortAddress(ev.signature, 4)} ↗</a>}
                    <Badge tone={ev.status === "confirmed" ? "accent" : ev.status === "failed" ? "danger" : ev.status === "submitted" ? "info" : "neutral"}>{ev.status === "prepared" ? "preview only" : ev.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {e && (
        <Card title="Limitations">
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted">{e.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
