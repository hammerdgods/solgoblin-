"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { useSettings } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Notice, Skeleton } from "@/components/ui";
import { ClientApiError, postJson, useApi } from "@/lib/client/api";
import type { MonitorRunResult } from "@/lib/monitor/run";
import type { AlertRow } from "@/lib/store/types";

export default function AlertsPage() {
  const { publicKey } = useWallet();
  const { demoMode } = useSettings();
  const wallet = publicKey?.toBase58();
  const alerts = useApi<{ alerts: AlertRow[]; persistence: { kind: string; durable: boolean } }>(demoMode ? null : `/api/alerts${wallet ? `?wallet=${wallet}` : ""}`, { refreshMs: 60_000 });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonitorRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      setResult(await postJson<MonitorRunResult>("/api/monitor/run", {}));
      alerts.refresh();
    } catch (e) {
      setError((e as ClientApiError).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alerts & monitoring</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">The monitor refreshes rates, records snapshots, and flags material APY changes, stale data, liquidity stress and validator issues. It never executes transactions.</p>
        </div>
        <Button variant="primary" size="sm" onClick={runNow} disabled={running || demoMode}>{running ? "Checking…" : "Run check now"}</Button>
      </div>

      {demoMode && <Notice tone="demo" title="Monitoring is disabled in demo mode">Alerts are only generated from live data.</Notice>}
      {error && <Notice tone="danger" title="Monitoring run failed">{error}</Notice>}
      {result && (
        <Notice tone={result.errors.length ? "warn" : "accent"} title="Monitoring run complete">
          Checked {result.opportunitiesChecked} opportunities, recorded {result.snapshotsRecorded} snapshots, raised {result.alertsRaised} new alert(s){result.walletsChecked ? `, reviewed ${result.walletsChecked} wallet(s)` : ""}.
          {result.errors.length > 0 && <> Errors: {result.errors.join("; ")}</>}
        </Notice>
      )}
      {alerts.data && !alerts.data.persistence.durable && <Notice tone="warn" title="Alerts are not persisted">The server is using an in-memory store, so alerts reset on restart. Configure Supabase or a writable DATA_DIR.</Notice>}

      <Card title="Recent alerts" subtitle={wallet ? "Market-wide alerts plus alerts for your wallet" : "Market-wide alerts (connect a wallet to include position reviews)"}>
        {alerts.loading && !alerts.data ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : alerts.error ? (
          <Notice tone="danger" title="Could not load alerts">{alerts.error.message}</Notice>
        ) : !alerts.data?.alerts.length ? (
          <EmptyState title="No alerts yet">The first monitoring run records a baseline. Rate-change alerts appear once a later run sees a change of at least the configured threshold.</EmptyState>
        ) : (
          <ul className="divide-y divide-border/70">
            {alerts.data.alerts.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warn" : "info"}>{a.severity === "critical" ? "▲ critical" : a.severity === "warning" ? "! warning" : "i info"}</Badge>
                    <span className="text-sm font-medium">{a.title}</span>
                  </div>
                  <span className="text-[11px] text-faint">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted">{a.detail}</p>
                <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "Show"} supporting data</button>
                {open === a.id && <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-bg p-2 text-[11px] text-muted">{JSON.stringify(a.data, null, 2)}</pre>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
