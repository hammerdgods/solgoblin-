import type { PositionReview } from "../agent/review";
import type { AlertRow, StrategySnapshotRow } from "../store/types";
import type { Opportunity } from "../types";
import { classifyFreshness } from "../yield/freshness";
import { rateDeltaBps } from "../yield/math";

/**
 * Pure alert evaluation. Produces alert rows (without ids/timestamps assigned
 * by the caller) from the current scan, the previous snapshots, and reviews.
 */

export interface MonitorThresholds {
  apyChangeAlertBps: number;
  staleAfterSeconds: number;
  utilizationWarning: number;
}

export type AlertDraft = Omit<AlertRow, "id" | "created_at">;

export function evaluateOpportunityAlerts(current: Opportunity[], previous: Map<string, StrategySnapshotRow>, now: Date, t: MonitorThresholds): AlertDraft[] {
  const alerts: AlertDraft[] = [];
  for (const o of current) {
    const prev = previous.get(o.id);
    if (prev) {
      const delta = rateDeltaBps(prev.apy, o.apy);
      if (Math.abs(delta) >= t.apyChangeAlertBps) {
        alerts.push({
          type: "apy-change",
          severity: delta < 0 ? "warning" : "info",
          title: `${o.strategyName}: rate ${delta < 0 ? "fell" : "rose"} ${Math.abs(delta)} bps`,
          detail: `APY moved from ${(prev.apy * 100).toFixed(3)}% (recorded ${prev.created_at}) to ${(o.apy * 100).toFixed(3)}%. Rates are variable; review whether this strategy still fits.`,
          opportunity_id: o.id,
          wallet: null,
          data: { previousApy: prev.apy, currentApy: o.apy, deltaBps: delta, previousAt: prev.created_at, source: o.source.name },
        });
      }
    }
    if (classifyFreshness(o.source, now, t.staleAfterSeconds) !== "fresh") {
      alerts.push({ type: "stale-data", severity: "warning", title: `${o.strategyName}: data is stale`, detail: `Last successful update ${o.source.fetchedAt}. Recommendations exclude stale opportunities.`, opportunity_id: o.id, wallet: null, data: { fetchedAt: o.source.fetchedAt } });
    }
    const util = o.metrics.utilization;
    if (o.kind === "lending" && util !== undefined && util >= t.utilizationWarning) {
      alerts.push({
        type: "liquidity",
        severity: "critical",
        title: `${o.strategyName}: utilization ${(util * 100).toFixed(1)}%`,
        detail: "Very high utilization means withdrawals may be delayed until borrowers repay or new deposits arrive.",
        opportunity_id: o.id,
        wallet: null,
        data: { utilization: util, threshold: t.utilizationWarning },
      });
    }
  }
  return alerts;
}

export function evaluateAdapterErrors(errors: { adapterId: string; message: string }[]): AlertDraft[] {
  return errors.map((e) => ({
    type: e.adapterId === "native-staking" && /validator/i.test(e.message) ? "validator" : "data-unavailable",
    severity: "warning",
    title: `${e.adapterId}: ${e.adapterId === "native-staking" && /validator/i.test(e.message) ? "validator issue" : "data unavailable"}`,
    detail: e.message,
    opportunity_id: null,
    wallet: null,
    data: { adapterId: e.adapterId },
  }));
}

export function evaluateReviewAlerts(wallet: string, reviews: PositionReview[]): AlertDraft[] {
  return reviews
    .filter((r) => r.verdict === "review")
    .map((r) => ({
      type: "position-review" as const,
      severity: "info" as const,
      title: `Review suggested: ${r.label}`,
      detail: r.reasons.join(" "),
      opportunity_id: r.current?.opportunityId ?? null,
      wallet,
      data: { alternative: r.alternative, estimatedBenefit: r.estimatedBenefit },
    }));
}

/** Suppress alerts identical in type/opportunity/wallet/title to one raised within `windowMs`. */
export function dedupeAlerts(drafts: AlertDraft[], recent: AlertRow[], now: Date, windowMs = 6 * 3600_000): AlertDraft[] {
  const key = (a: Pick<AlertRow, "type" | "opportunity_id" | "wallet" | "title">) => `${a.type}|${a.opportunity_id}|${a.wallet}|${a.type === "apy-change" ? "" : a.title}`;
  const seen = new Set(recent.filter((r) => now.getTime() - Date.parse(r.created_at) < windowMs).map(key));
  const out: AlertDraft[] = [];
  for (const d of drafts) {
    const k = key(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}
