"use client";

import { useState } from "react";
import type { DecisionRecord } from "@/lib/agent/schema";
import { ClientApiError, postJson } from "@/lib/client/api";
import { formatPercent, formatToken } from "@/lib/format";
import type { AssetSymbol, Opportunity } from "@/lib/types";
import { useSettings } from "./providers";
import { Badge, Button, Card, KeyValue, Notice, Skeleton } from "./ui";

const actionTone = { deposit: "accent", hold: "neutral", configure: "warn", "review-position": "info" } as const;

export function AgentPanel({ wallet, idle, opportunities, onReview }: { wallet: string | null; idle: Partial<Record<AssetSymbol, number>> | null; opportunities: Opportunity[]; onReview: (o: Opportunity, amount: number) => void }) {
  const { demoMode, preferences, profile } = useSettings();
  const [asset, setAsset] = useState<AssetSymbol>("USDC");
  const [amount, setAmount] = useState("");
  const [record, setRecord] = useState<DecisionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const suggested = idle?.[asset];
  const amountNum = amount === "" ? (suggested !== undefined ? Math.max(0, asset === "SOL" ? suggested - 0.06 : suggested) : 0) : Number(amount);

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      const res = await postJson<{ record: DecisionRecord }>("/api/agent/recommend", { mode: demoMode ? "demo" : "live", asset, amount: Number.isFinite(amountNum) ? Math.max(0, Number(amountNum.toFixed(6))) : 0, wallet, preferences });
      setRecord(res.record);
    } catch (e) {
      setError((e as ClientApiError).message);
    } finally {
      setLoading(false);
    }
  }

  const selectedOpp = record?.selectedStrategy ? opportunities.find((o) => o.id === record.selectedStrategy!.opportunityId) ?? null : null;

  return (
    <Card title="Agent recommendation" subtitle={`Profile: ${profile} · deterministic ranking, optional AI explanation`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-muted">Asset</span>
          <select value={asset} onChange={(e) => { setAsset(e.target.value as AssetSymbol); setAmount(""); }} className="mt-1 block h-9 rounded-lg border border-border-strong bg-bg px-2.5 text-sm">
            <option value="USDC">USDC</option>
            <option value="SOL">SOL</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Amount to put to work</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={suggested !== undefined ? `${formatToken(Math.max(0, asset === "SOL" ? suggested - 0.06 : suggested), "", 4).trim()} (idle)` : "0"} className="mt-1 block h-9 w-44 rounded-lg border border-border-strong bg-bg px-3 font-mono text-sm outline-none focus:border-accent" />
        </label>
        <Button variant="primary" onClick={ask} disabled={loading}>{loading ? "Analyzing…" : "Get recommendation"}</Button>
      </div>
      {asset === "SOL" && amount === "" && suggested !== undefined && <p className="mt-2 text-[11px] text-faint">Suggested amount leaves 0.06 SOL for fees.</p>}

      <div className="mt-4">
        {loading && <Skeleton className="h-28 w-full" />}
        {error && <Notice tone="danger" title="Recommendation failed">{error}</Notice>}
        {record && !loading && (
          <div className="animate-fade-in space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={actionTone[record.recommendation.action]}>{record.recommendation.action}</Badge>
              <Badge tone={record.confidence.level === "high" ? "accent" : record.confidence.level === "medium" ? "warn" : "danger"}>confidence: {record.confidence.level}</Badge>
              <Badge tone={record.mode === "demo" ? "demo" : "neutral"}>{record.mode === "demo" ? "DEMO" : record.engine === "ai-assisted" ? `AI-explained · ${record.model}` : "deterministic"}</Badge>
            </div>
            <p className="text-sm leading-6">{record.explanation.summary}</p>
            <p className="text-[13px] leading-5 text-muted">{record.explanation.rationale}</p>
            {record.explanation.llmFallbackReason && <p className="text-[11px] text-faint">{record.explanation.llmFallbackReason}</p>}

            {record.expectedNetYield && (
              <KeyValue
                items={[
                  { k: "Principal", v: formatToken(record.expectedNetYield.principal, record.expectedNetYield.asset, 6) },
                  { k: "Horizon", v: `${record.expectedNetYield.horizonDays} days` },
                  { k: "Gross yield (est.)", v: formatToken(record.expectedNetYield.grossYield, record.expectedNetYield.asset, 6) },
                  { k: "Fees (est.)", v: `−${formatToken(record.expectedNetYield.networkFees + record.expectedNetYield.protocolFee, record.expectedNetYield.asset, 6)}${record.expectedNetYield.feesIncluded ? "" : " (SOL fees not priced)"}` },
                  { k: "Net yield (est.)", v: formatToken(record.expectedNetYield.netYield, record.expectedNetYield.asset, 6) },
                  { k: "Annualized net", v: formatPercent(record.expectedNetYield.effectiveAnnualRate, 2) },
                ]}
              />
            )}
            <div className="text-[13px] text-muted"><span className="font-medium text-text">Uncertainty:</span> {record.explanation.uncertainty}</div>
            <div className="text-[13px]"><span className="font-medium">Next:</span> <span className="text-muted">{record.suggestedNextAction}</span></div>

            <div className="flex flex-wrap gap-2">
              {record.recommendation.action === "deposit" && selectedOpp && (
                <Button variant="primary" onClick={() => onReview(selectedOpp, record.input.amount)}>Review transaction</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowAudit((s) => !s)}>{showAudit ? "Hide" : "Show"} decision record</Button>
            </div>

            {showAudit && (
              <div className="space-y-3 rounded-lg border border-border bg-bg/50 p-3 text-[13px]">
                <div>
                  <div className="text-xs font-medium text-muted">Supporting data</div>
                  <ul className="mt-1 space-y-0.5">{record.supportingData.map((s) => <li key={s.label}><span className="text-muted">{s.label}:</span> {s.value} <span className="text-[11px] text-faint">({s.source}{s.fetchedAt ? `, ${new Date(s.fetchedAt).toLocaleTimeString()}` : ""})</span></li>)}</ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted">Assumptions</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">{record.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
                {record.alternatives.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted">Alternatives considered</div>
                    <ul className="mt-1 space-y-0.5">{record.alternatives.map((a) => <li key={a.opportunityId}>{a.strategyName}: <span className="text-muted">{a.reason}</span></li>)}</ul>
                  </div>
                )}
                {record.excluded.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted">Excluded</div>
                    <ul className="mt-1 space-y-0.5">{record.excluded.map((a) => <li key={a.opportunityId}>{a.strategyName}: <span className="text-muted">{a.reasons.join(" ")}</span></li>)}</ul>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-muted">Data freshness</div>
                  <ul className="mt-1 space-y-0.5">{record.dataFreshness.map((d) => <li key={d.source}>{d.source}: <Badge tone={d.status === "fresh" ? "accent" : "warn"}>{d.status}</Badge> <span className="text-faint">{d.ageSeconds !== null ? `${d.ageSeconds}s old` : ""}</span></li>)}</ul>
                </div>
                <div className="text-[11px] text-faint">Record {record.id} · {record.createdAt}</div>
                <p className="text-[11px] text-faint">{record.disclaimer}</p>
              </div>
            )}
          </div>
        )}
        {!record && !loading && !error && <p className="text-[13px] text-muted">Choose an asset and amount. The agent compares the opportunities that fit your settings and explains its choice, along with fees, risks, assumptions and data freshness.</p>}
      </div>
    </Card>
  );
}
