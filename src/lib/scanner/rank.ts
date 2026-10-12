import { LAMPORTS_PER_SOL } from "../constants";
import type { AssetSymbol, Opportunity, RiskLevel, RiskPreferences } from "../types";
import { classifyFreshness } from "../yield/freshness";
import { estimateNetYield, type NetYieldEstimate } from "../yield/math";

/**
 * Deterministic, transparent opportunity ranking.
 *
 * score = fee-adjusted effective annual rate
 *         − risk penalty (by tier)
 *         − liquidity penalty (per day of withdrawal delay)
 *
 * The highest raw APY therefore does NOT automatically win. All penalties are
 * explicit constants returned with every score so the UI can show the math.
 */

export const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export interface RankingWeights {
  /** Penalty subtracted from the annual rate per risk tier, as a fraction. */
  riskPenalty: Record<RiskLevel, number>;
  /** Penalty per day of withdrawal delay, as a fraction of annual rate. */
  liquidityPenaltyPerDay: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  riskPenalty: { low: 0, medium: 0.01, high: 0.04 },
  liquidityPenaltyPerDay: 0.001,
};

export const RISK_PROFILES: Record<"conservative" | "balanced" | "adventurous", RiskPreferences> = {
  conservative: { maxRiskLevel: "low", maxWithdrawalDelayHours: 96, allowedAssets: ["SOL", "USDC"], horizonDays: 90 },
  balanced: { maxRiskLevel: "medium", maxWithdrawalDelayHours: 96, allowedAssets: ["SOL", "USDC"], horizonDays: 90 },
  adventurous: { maxRiskLevel: "high", maxWithdrawalDelayHours: 24 * 14, allowedAssets: ["SOL", "USDC"], horizonDays: 90 },
};

export interface RankingContext {
  now: Date;
  staleAfterSeconds: number;
  /** Amount the user intends to deploy, per asset (asset units). */
  principalByAsset: Partial<Record<AssetSymbol, number>>;
  /** USD prices by asset, if reliable. Used only to convert SOL network fees into the deposit asset. */
  usdPrices: Partial<Record<AssetSymbol, number>>;
  weights?: RankingWeights;
}

export interface ScoreBreakdown {
  effectiveAnnualRate: number;
  riskPenalty: number;
  liquidityPenalty: number;
  score: number;
}

export interface RankedOpportunity {
  opportunity: Opportunity;
  eligible: boolean;
  exclusionReasons: string[];
  warnings: string[];
  principal: number;
  netYield: NetYieldEstimate;
  /** Whether network fees could be converted into the deposit asset. */
  feesConverted: boolean;
  score: ScoreBreakdown;
}

const MAX_PLAUSIBLE_APY = 1;

function networkFeesInAsset(o: Opportunity, ctx: RankingContext): { amount: number; converted: boolean } {
  const lamports = o.costs.entryNetworkFeeLamports + o.costs.exitNetworkFeeLamports;
  const sol = lamports / LAMPORTS_PER_SOL;
  if (o.asset === "SOL") return { amount: sol, converted: true };
  const solUsd = ctx.usdPrices.SOL;
  const assetUsd = ctx.usdPrices[o.asset];
  if (solUsd && assetUsd && solUsd > 0 && assetUsd > 0) return { amount: (sol * solUsd) / assetUsd, converted: true };
  return { amount: 0, converted: false };
}

export function evaluateOpportunity(o: Opportunity, prefs: RiskPreferences, ctx: RankingContext): RankedOpportunity {
  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const exclusionReasons: string[] = [];
  const warnings: string[] = [];

  if (!prefs.allowedAssets.includes(o.asset)) exclusionReasons.push(`${o.asset} is not in your allowed assets.`);
  if (RISK_ORDER[o.riskLevel] > RISK_ORDER[prefs.maxRiskLevel]) exclusionReasons.push(`Risk level "${o.riskLevel}" exceeds your maximum "${prefs.maxRiskLevel}".`);
  if (o.liquidity.withdrawalDelayHours > prefs.maxWithdrawalDelayHours) exclusionReasons.push(`Withdrawal delay (~${Math.round(o.liquidity.withdrawalDelayHours)}h) exceeds your maximum (${prefs.maxWithdrawalDelayHours}h).`);
  if (!Number.isFinite(o.apy) || o.apy < 0 || o.apy > MAX_PLAUSIBLE_APY) exclusionReasons.push("Rate is missing or outside plausible bounds.");
  const freshness = classifyFreshness(o.source, ctx.now, ctx.staleAfterSeconds);
  if (freshness !== "fresh") exclusionReasons.push(freshness === "stale" ? "Rate data is stale." : "Rate data has no valid timestamp.");

  const principal = Math.max(0, ctx.principalByAsset[o.asset] ?? 0);
  if (o.liquidity.minimumDeposit !== null && principal > 0 && principal < o.liquidity.minimumDeposit) {
    exclusionReasons.push(`Amount ${principal} ${o.asset} is below the minimum of ${o.liquidity.minimumDeposit} ${o.asset}.`);
  }
  if (!o.executable) warnings.push(o.executableReason ?? "YieldGoblin cannot build a transaction for this opportunity on the current network.");

  const fees = networkFeesInAsset(o, ctx);
  if (!fees.converted) warnings.push("Network fees (paid in SOL) are not included in the net estimate because no reliable price was available.");

  const warmupDays = (o.metrics.warmupHours ?? 0) / 24;
  const safeApy = Number.isFinite(o.apy) ? Math.max(0, Math.min(o.apy, MAX_PLAUSIBLE_APY)) : 0;
  const netYield = estimateNetYield({ principal, apy: safeApy, days: prefs.horizonDays, protocolFeeRate: o.costs.protocolFeeRate, networkFeesInAsset: fees.amount, warmupDays });
  if (principal > 0 && netYield.netYield <= 0) warnings.push("At this amount and horizon, estimated costs exceed estimated yield.");

  // With no principal, rank by the rate itself (minus warm-up drag).
  const effectiveAnnualRate = principal > 0 && netYield.effectiveAnnualRate !== null ? netYield.effectiveAnnualRate : safeApy * Math.max(0, 1 - warmupDays / Math.max(1, prefs.horizonDays));
  const riskPenalty = weights.riskPenalty[o.riskLevel];
  const liquidityPenalty = (o.liquidity.withdrawalDelayHours / 24) * weights.liquidityPenaltyPerDay;
  const score = effectiveAnnualRate - riskPenalty - liquidityPenalty;

  return {
    opportunity: o,
    eligible: exclusionReasons.length === 0,
    exclusionReasons,
    warnings,
    principal,
    netYield,
    feesConverted: fees.converted,
    score: { effectiveAnnualRate, riskPenalty, liquidityPenalty, score },
  };
}

/** Sort: eligible first, then score desc, then id for full determinism. */
export function rankOpportunities(ops: Opportunity[], prefs: RiskPreferences, ctx: RankingContext): RankedOpportunity[] {
  return ops
    .map((o) => evaluateOpportunity(o, prefs, ctx))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score.score - a.score.score || a.opportunity.id.localeCompare(b.opportunity.id));
}

export function bestForAsset(ranked: RankedOpportunity[], asset: AssetSymbol): RankedOpportunity | null {
  return ranked.find((r) => r.eligible && r.opportunity.asset === asset) ?? null;
}
