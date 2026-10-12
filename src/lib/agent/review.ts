import { LAMPORTS_PER_SOL } from "../constants";
import { formatPercent } from "../format";
import type { RankedOpportunity } from "../scanner/rank";
import type { AssetSymbol } from "../types";
import { grossYieldForPeriod, rateDeltaBps } from "../yield/math";

/**
 * Deterministic position review: flags positions where a materially better
 * eligible alternative exists AFTER switching costs, or where the current
 * strategy no longer meets the user's constraints. Never moves funds.
 */

export interface HeldPosition {
  id: string;
  asset: AssetSymbol;
  amount: number;
  /** Opportunity id that describes the strategy this position is in, if known. */
  opportunityId: string | null;
  label: string;
}

export interface PositionReview {
  positionId: string;
  label: string;
  verdict: "keep" | "review";
  reasons: string[];
  current: { opportunityId: string; apy: number } | null;
  alternative: { opportunityId: string; strategyName: string; apy: number } | null;
  /** Estimated extra yield over the horizon minus switching costs, in asset units. */
  estimatedBenefit: number | null;
}

export function reviewPositions(positions: HeldPosition[], ranked: RankedOpportunity[], opts: { horizonDays: number; minImprovementBps: number; solUsd?: number; assetUsd?: Partial<Record<AssetSymbol, number>> }): PositionReview[] {
  return positions.map((p) => {
    const current = p.opportunityId ? ranked.find((r) => r.opportunity.id === p.opportunityId) ?? null : null;
    const best = ranked.find((r) => r.eligible && r.opportunity.asset === p.asset && r.opportunity.executable && r.opportunity.id !== p.opportunityId) ?? null;
    const reasons: string[] = [];
    let verdict: PositionReview["verdict"] = "keep";
    let estimatedBenefit: number | null = null;

    if (!current) {
      reasons.push("Current strategy data is unavailable; SolGoblin cannot evaluate this position right now.");
    } else if (!current.eligible) {
      verdict = "review";
      reasons.push(`This strategy no longer meets your settings: ${current.exclusionReasons.join(" ")}`);
    } else if (current.opportunity.risks.some((r) => r.level === "high")) {
      verdict = "review";
      reasons.push(...current.opportunity.risks.filter((r) => r.level === "high").map((r) => r.detail));
    }

    if (current && best) {
      const delta = rateDeltaBps(current.opportunity.apy, best.opportunity.apy);
      if (delta >= opts.minImprovementBps) {
        const extra = grossYieldForPeriod(p.amount, best.opportunity.apy, opts.horizonDays) - grossYieldForPeriod(p.amount, current.opportunity.apy, opts.horizonDays);
        const costLamports = current.opportunity.costs.exitNetworkFeeLamports + best.opportunity.costs.entryNetworkFeeLamports;
        const costSol = costLamports / LAMPORTS_PER_SOL;
        const assetPrice = opts.assetUsd?.[p.asset];
        const costInAsset = p.asset === "SOL" ? costSol : opts.solUsd && assetPrice ? (costSol * opts.solUsd) / assetPrice : null;
        // Staking warm-up/cool-down means idle days while switching.
        const idleDays = ((current.opportunity.liquidity.withdrawalDelayHours || 0) + (best.opportunity.metrics.warmupHours || 0)) / 24;
        const idleLoss = grossYieldForPeriod(p.amount, current.opportunity.apy, idleDays);
        if (costInAsset !== null) {
          estimatedBenefit = extra - costInAsset - idleLoss;
          if (estimatedBenefit > 0) {
            verdict = "review";
            reasons.push(`${best.opportunity.strategyName} currently shows ${formatPercent(best.opportunity.apy)} vs ${formatPercent(current.opportunity.apy)} (+${delta} bps). Over ${opts.horizonDays} days the estimated benefit after switching costs is positive, assuming rates stay constant (they will not).`);
          } else {
            reasons.push(`A higher-rate option exists (+${delta} bps), but switching costs and idle time likely outweigh the benefit over ${opts.horizonDays} days.`);
          }
        } else {
          reasons.push(`A higher-rate option exists (+${delta} bps), but switching costs could not be priced.`);
        }
      }
    }
    if (reasons.length === 0) reasons.push("No material change detected.");
    return {
      positionId: p.id,
      label: p.label,
      verdict,
      reasons,
      current: current ? { opportunityId: current.opportunity.id, apy: current.opportunity.apy } : null,
      alternative: best ? { opportunityId: best.opportunity.id, strategyName: best.opportunity.strategyName, apy: best.opportunity.apy } : null,
      estimatedBenefit,
    };
  });
}
