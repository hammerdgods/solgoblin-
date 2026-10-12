"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { OpportunityTable, ScanErrors, useOpportunities } from "@/components/opportunities";
import { useSettings } from "@/components/providers";
import { TxReviewDialog } from "@/components/tx-review";
import { Button, Card, Notice } from "@/components/ui";
import { usePortfolio } from "@/components/portfolio";
import type { Opportunity } from "@/lib/types";

export default function OpportunitiesPage() {
  const { preferences, profile, demoMode } = useSettings();
  const { publicKey } = useWallet();
  const portfolio = usePortfolio(publicKey?.toBase58() ?? null);
  const idle = portfolio.data?.totals.idle ?? null;
  const [amounts, setAmounts] = useState<{ SOL: string; USDC: string }>({ SOL: "", USDC: "" });
  const opps = useOpportunities({ SOL: Number(amounts.SOL) || 0, USDC: Number(amounts.USDC) || 0 });
  const [selected, setSelected] = useState<Opportunity | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Opportunity scanner</h1>
          <p className="mt-1 text-sm text-muted">
            Ranked by a transparent, deterministic score for your <span className="text-text">{profile}</span> profile (max risk {preferences.maxRiskLevel}, max withdrawal delay {preferences.maxWithdrawalDelayHours}h, {preferences.horizonDays}-day horizon). The highest APY does not automatically win.
          </p>
        </div>
        <Button size="sm" onClick={opps.refresh} disabled={opps.loading}>{opps.loading ? "Refreshing…" : "Refresh"}</Button>
      </div>

      <Card title="Estimate with your amounts" subtitle="Optional. Used only to compute fee-adjusted net estimates.">
        <div className="flex flex-wrap gap-4">
          {(["SOL", "USDC"] as const).map((a) => (
            <label key={a} className="text-sm">
              <span className="text-muted">{a} amount</span>
              <input inputMode="decimal" value={amounts[a]} onChange={(e) => setAmounts((s) => ({ ...s, [a]: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder={idle ? String(idle[a] ?? 0) : "0"} className="mt-1 block h-9 w-40 rounded-lg border border-border-strong bg-bg px-3 font-mono text-sm outline-none focus:border-accent" />
            </label>
          ))}
        </div>
      </Card>

      <ScanErrors data={opps.data} />
      {opps.error && <Notice tone="danger" title="Could not load opportunities">{opps.error.message}</Notice>}
      {!demoMode && !publicKey && <Notice tone="info" title="Wallet not connected">You can browse opportunities without a wallet. Connect one to deposit.</Notice>}

      <Card title={`${demoMode ? "Demo" : "Live"} opportunities`} subtitle={opps.data ? `Network: ${opps.data.scan.network} · scanned ${new Date(opps.data.scan.scannedAt).toLocaleTimeString()}` : undefined}>
        <OpportunityTable data={opps.data} loading={opps.loading} onSelect={setSelected} horizonDays={preferences.horizonDays} />
      </Card>

      {selected && (
        <TxReviewDialog
          opportunity={selected}
          available={idle ? { SOL: idle.SOL ?? 0, USDC: idle.USDC ?? 0 } : null}
          defaultAmount={Number(amounts[selected.asset]) || undefined}
          onClose={() => setSelected(null)}
          onConfirmed={() => {
            portfolio.refresh();
            opps.refresh();
          }}
        />
      )}
    </div>
  );
}
