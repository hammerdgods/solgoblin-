"use client";

import { useConfigStatus } from "@/components/app-shell";
import { useSettings } from "@/components/providers";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { Badge, Card, KeyValue, Notice, Skeleton } from "@/components/ui";
import { RISK_PROFILES } from "@/lib/scanner/rank";
import type { RiskLevel } from "@/lib/types";

export default function SettingsPage() {
  const { profile, preferences, setProfile, demoMode, setDemoMode } = useSettings();
  const config = useConfigStatus();
  const c = config.data;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Card title="Risk preferences" subtitle="Used by the scanner and the agent. Stored in this browser only.">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RISK_PROFILES) as (keyof typeof RISK_PROFILES)[]).map((p) => (
            <button key={p} onClick={() => setProfile(p)} className={`rounded-lg border px-3 py-2 text-left text-sm ${profile === p ? "border-accent bg-accent-dim" : "border-border-strong bg-surface-2 hover:border-faint"}`}>
              <div className="font-medium capitalize">{p}</div>
              <div className="text-[11px] text-muted">max risk {RISK_PROFILES[p].maxRiskLevel} · ≤{RISK_PROFILES[p].maxWithdrawalDelayHours}h withdrawal</div>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-muted">Max risk level</span>
            <select value={preferences.maxRiskLevel} onChange={(e) => setProfile("custom", { ...preferences, maxRiskLevel: e.target.value as RiskLevel })} className="mt-1 block h-9 w-full rounded-lg border border-border-strong bg-bg px-2.5 text-sm">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Max withdrawal delay (hours)</span>
            <input type="number" min={0} max={1440} value={preferences.maxWithdrawalDelayHours} onChange={(e) => setProfile("custom", { ...preferences, maxWithdrawalDelayHours: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })} className="mt-1 block h-9 w-full rounded-lg border border-border-strong bg-bg px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Estimate horizon (days)</span>
            <input type="number" min={1} max={3650} value={preferences.horizonDays} onChange={(e) => setProfile("custom", { ...preferences, horizonDays: Math.max(1, Math.min(3650, Math.round(Number(e.target.value) || 1))) })} className="mt-1 block h-9 w-full rounded-lg border border-border-strong bg-bg px-3 text-sm" />
          </label>
        </div>
        <p className="mt-3 text-[11px] text-faint">Risk tiers are YieldGoblin&apos;s own coarse classification, not a protocol rating. Native staking is “low”; lending is “medium”, and becomes “high” when reserve utilization is near its limit.</p>
      </Card>

      <Card title="Data mode">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 accent-[#c08cf4]" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
          <span>
            <span className="font-medium">Demo mode</span>
            <span className="block text-[13px] text-muted">Shows a fictional dataset and portfolio for exploring the interface. Demo data is never mixed with live data, the AI is not used, and no transactions can be built.</span>
          </span>
        </label>
      </Card>

      <Card title="Server configuration checks" subtitle="All must pass before transactions can be prepared">
        {!c ? <Skeleton className="h-32 w-full" /> : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {c.checks.map((k) => (
                <li key={k.id} className="flex items-start gap-2 text-[13px]">
                  <Badge tone={k.ok ? "accent" : k.id === "validators" ? "warn" : "danger"}>{k.ok ? "✓ pass" : "✕ fail"}</Badge>
                  <span><span className="font-medium">{k.label}</span> <span className="text-muted">— {k.detail}</span></span>
                </li>
              ))}
            </ul>
            <Notice tone={c.transactionsEnabled ? "accent" : "warn"} title={c.transactionsEnabled ? "Transaction preparation is enabled" : "Transaction preparation is disabled"}>
              Even when enabled, every transaction needs your explicit review and wallet signature. Mainnet execution is off by default and requires an operator to set ENABLE_MAINNET_TRANSACTIONS=true. The emergency kill switch (TRANSACTIONS_KILL_SWITCH) disables everything immediately.
            </Notice>
            <KeyValue items={[
              { k: "AI explanations", v: c.ai.configured ? <Badge tone="accent">{c.ai.model}</Badge> : <Badge>off — deterministic only</Badge> },
              { k: "Persistence", v: `${c.persistence.kind}${c.persistence.durable ? "" : " (not durable)"}` },
              { k: "Max deposit per tx", v: `${c.limits.maxDepositSol} SOL · ${c.limits.maxDepositUsdc} USDC` },
              { k: "SOL kept for fees", v: `${c.limits.minSolReserve} SOL` },
              { k: "Stale data after", v: `${c.monitoring.staleAfterSeconds}s` },
              { k: "APY change alert", v: `${c.monitoring.apyChangeAlertBps} bps` },
            ]} />
          </div>
        )}
      </Card>

      <Card title="Risk disclosure">
        <RiskDisclosure compact />
      </Card>
    </div>
  );
}
