import { LAMPORTS_PER_SOL, type SolanaNetwork } from "../constants";
import { formatPercent } from "../format";
import type { RankedOpportunity } from "../scanner/rank";
import type { AssetSymbol, DataKind, PriceQuote, RiskPreferences } from "../types";
import { classifyFreshness, sourceAgeSeconds } from "../yield/freshness";
import { DISCLAIMER, type DecisionRecord } from "./schema";

export interface DecisionInput {
  id: string;
  asset: AssetSymbol;
  amount: number;
  wallet: string | null;
  preferences: RiskPreferences;
  mode: DataKind;
  network: SolanaNetwork;
  now: Date;
  staleAfterSeconds: number;
  prices: Partial<Record<AssetSymbol, PriceQuote>>;
}

const fmtAmt = (n: number, d = 6) => Number(n.toFixed(d)).toString();

/** Build a complete decision record using only deterministic logic and sourced data. */
export function buildDeterministicDecision(input: DecisionInput, ranked: RankedOpportunity[]): DecisionRecord {
  const sameAsset = ranked.filter((r) => r.opportunity.asset === input.asset);
  const eligible = sameAsset.filter((r) => r.eligible);
  const best = eligible[0] ?? null;
  const o = best?.opportunity ?? null;

  let action: DecisionRecord["recommendation"]["action"];
  let headline: string;
  let next: string;

  if (sameAsset.length === 0) {
    action = "hold";
    headline = `No ${input.asset} opportunities are available right now.`;
    next = "Check the scanner for data-source errors and try again later.";
  } else if (!best) {
    action = "hold";
    headline = `No ${input.asset} opportunity satisfies your risk and liquidity settings.`;
    next = "Review the excluded opportunities below, or adjust your preferences if you are comfortable with more risk.";
  } else if (input.amount <= 0) {
    action = "hold";
    headline = `No ${input.asset} amount entered; ${o!.strategyName} is the top match for your settings.`;
    next = `Enter how much ${input.asset} you want to put to work to see a fee-adjusted estimate.`;
  } else if (best.netYield.netYield <= 0) {
    action = "hold";
    headline = `Estimated costs exceed estimated yield for ${fmtAmt(input.amount)} ${input.asset} over ${input.preferences.horizonDays} days.`;
    next = "Consider a larger amount or a longer horizon, or keep the funds idle.";
  } else if (!o!.executable) {
    action = "configure";
    headline = `${o!.strategyName} is the best match, but YieldGoblin cannot execute it in the current configuration.`;
    next = o!.executableReason ?? "Update the configuration to enable this strategy.";
  } else {
    action = "deposit";
    headline = `${o!.strategyName} on ${o!.protocol} is the best risk-adjusted match for your ${input.asset}.`;
    next = `Review the transaction preview for depositing ${fmtAmt(input.amount)} ${input.asset}. Nothing happens until you approve it in your wallet.`;
  }

  const supportingData: DecisionRecord["supportingData"] = [];
  if (o) {
    supportingData.push({ label: o.rateType === "staking-apy" ? "Estimated staking APY" : "Lending supply APY", value: formatPercent(o.apy, 3), source: o.source.name, fetchedAt: o.source.fetchedAt });
    if (o.apr !== null) supportingData.push({ label: "Underlying APR", value: formatPercent(o.apr, 3), source: o.source.name, fetchedAt: o.source.fetchedAt });
    if (o.metrics.utilization !== undefined) supportingData.push({ label: "Reserve utilization", value: formatPercent(o.metrics.utilization, 1), source: o.source.name, fetchedAt: o.source.fetchedAt });
    if (o.metrics.commission !== undefined) supportingData.push({ label: "Validator commission", value: formatPercent(o.metrics.commission, 1), source: o.source.name, fetchedAt: o.source.fetchedAt });
    supportingData.push({ label: "Risk-adjusted score", value: formatPercent(best!.score.score, 3), source: "YieldGoblin deterministic ranking", fetchedAt: null });
  }
  for (const [sym, p] of Object.entries(input.prices)) {
    if (p) supportingData.push({ label: `${sym}/USD`, value: `$${p.usd.toFixed(4)}`, source: p.source.name, fetchedAt: p.priceTimestamp });
  }

  const assumptions: string[] = [
    `The current rate is assumed constant for ${input.preferences.horizonDays} days. Real rates change continuously.`,
    "Yield is estimated in the deposited asset. USD price changes are not counted as yield.",
  ];
  if (o) {
    assumptions.push(...o.rateNotes);
    if ((o.metrics.warmupHours ?? 0) > 0) assumptions.push(`No rewards are assumed until stake activates (~${(o.metrics.warmupHours / 24).toFixed(1)} days).`);
    if (best && !best.feesConverted) assumptions.push("Network fees are excluded from the net estimate because no reliable SOL price was available.");
    else assumptions.push("Network fees for one deposit and one withdrawal are included.");
  }

  const dataFreshness: DecisionRecord["dataFreshness"] = [];
  const seen = new Set<string>();
  for (const r of sameAsset) {
    const key = r.opportunity.source.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const age = sourceAgeSeconds(r.opportunity.source, input.now);
    dataFreshness.push({ source: key, fetchedAt: r.opportunity.source.fetchedAt, ageSeconds: age === null ? null : Math.round(age), status: classifyFreshness(r.opportunity.source, input.now, input.staleAfterSeconds) });
  }

  // Confidence: start high and downgrade with explicit reasons.
  const reasons: string[] = [];
  let level: "low" | "medium" | "high" = "high";
  const downgrade = (to: "low" | "medium", why: string) => {
    reasons.push(why);
    if (to === "low" || level === "high") level = to;
  };
  if (input.mode === "demo") downgrade("low", "Demo data is fictional.");
  if (o && o.network !== "mainnet-beta" && input.mode === "live") downgrade("low", `${o.network} rates are not representative of mainnet.`);
  if (dataFreshness.some((d) => d.status !== "fresh")) downgrade("low", "Some source data is stale.");
  if (o?.rateType === "staking-apy") downgrade("medium", "Staking APY is derived from network-wide inflation data, not reported per validator; actual rewards depend on validator performance.");
  if (o?.rateType === "lending-supply-apy") downgrade("medium", "Lending rates move with utilization and can change quickly.");
  if (best && !best.feesConverted) downgrade("medium", "Network fees could not be priced.");
  if (!o) downgrade("low", "No eligible opportunity to evaluate.");
  if (reasons.length === 0) reasons.push("Fresh live data with all costs included.");

  const alternatives = eligible.slice(1, 4).map((r) => ({
    opportunityId: r.opportunity.id,
    strategyName: r.opportunity.strategyName,
    apy: r.opportunity.apy,
    score: r.score.score,
    reason: `Lower risk-adjusted score (${formatPercent(r.score.score, 2)} vs ${formatPercent(best!.score.score, 2)}).`,
  }));
  const excluded = sameAsset.filter((r) => !r.eligible).map((r) => ({ opportunityId: r.opportunity.id, strategyName: r.opportunity.strategyName, reasons: r.exclusionReasons }));

  const higherApyButLower = eligible.slice(1).find((r) => o && r.opportunity.apy > o.apy);
  const excludedHigher = excluded.length > 0 && o ? sameAsset.filter((r) => !r.eligible && r.opportunity.apy > o.apy) : [];

  const nyText = best && input.amount > 0
    ? `For ${fmtAmt(input.amount)} ${input.asset} over ${input.preferences.horizonDays} days, the estimated net yield is ${fmtAmt(best.netYield.netYield)} ${input.asset} after estimated fees (${best.netYield.effectiveAnnualRate !== null ? formatPercent(best.netYield.effectiveAnnualRate, 2) : "n/a"} annualized).`
    : "";

  const summary = o ? `${headline} ${nyText}`.trim() : headline;
  const rationale = o
    ? [
        `It has the highest risk-adjusted score among ${eligible.length} eligible ${input.asset} option(s): ${formatPercent(o.apy, 2)} APY, minus a ${formatPercent(best!.score.riskPenalty, 2)} risk penalty (${o.riskLevel} risk) and a ${formatPercent(best!.score.liquidityPenalty, 2)} liquidity penalty.`,
        higherApyButLower ? `${higherApyButLower.opportunity.strategyName} shows a higher APY (${formatPercent(higherApyButLower.opportunity.apy, 2)}) but scores lower after risk and liquidity adjustments.` : "",
        excludedHigher.length ? `${excludedHigher.length} higher-APY option(s) were excluded by your risk or liquidity settings.` : "",
      ].filter(Boolean).join(" ")
    : "No eligible opportunity was found for the selected asset under your current settings.";
  const riskExplanation = o ? o.risks.map((r) => `${r.title} (${r.level}): ${r.detail}`).join(" ") : "Not applicable.";
  const uncertainty = `Confidence is ${level}: ${reasons.join(" ")}`;

  return {
    id: input.id,
    createdAt: input.now.toISOString(),
    mode: input.mode,
    network: input.network,
    engine: "deterministic",
    model: null,
    input: { asset: input.asset, amount: input.amount, wallet: input.wallet, preferences: input.preferences },
    recommendation: { action, headline },
    selectedStrategy: o ? { opportunityId: o.id, protocol: o.protocol, strategyName: o.strategyName, rateType: o.rateType, apy: o.apy, executable: o.executable, score: best!.score.score } : null,
    supportingData,
    expectedNetYield:
      best && input.amount > 0
        ? {
            asset: input.asset,
            principal: best.netYield.principal,
            horizonDays: best.netYield.days,
            grossYield: best.netYield.grossYield,
            protocolFee: best.netYield.protocolFee,
            networkFees: best.netYield.networkFees,
            netYield: best.netYield.netYield,
            effectiveAnnualRate: best.netYield.effectiveAnnualRate,
            breakEvenDays: best.netYield.breakEvenDays,
            feesIncluded: best.feesConverted,
          }
        : null,
    assumptions,
    risks: o?.risks ?? [],
    fees: o ? { ...o.costs } : null,
    dataFreshness,
    confidence: { level, explanation: reasons.join(" ") },
    alternatives,
    excluded,
    suggestedNextAction: next,
    explanation: { generatedBy: "template", summary, rationale, riskExplanation, uncertainty, llmFallbackReason: null },
    disclaimer: DISCLAIMER,
  };
}

/** Every number the LLM is allowed to mention, drawn from the record. */
export function numericFacts(record: DecisionRecord): number[] {
  const nums: number[] = [record.input.amount, record.input.preferences.horizonDays, record.input.preferences.maxWithdrawalDelayHours];
  if (record.selectedStrategy) nums.push(record.selectedStrategy.apy, record.selectedStrategy.score);
  const ny = record.expectedNetYield;
  if (ny) nums.push(ny.principal, ny.grossYield, ny.netYield, ny.networkFees, ny.protocolFee, ny.effectiveAnnualRate ?? 0, ny.breakEvenDays ?? 0);
  for (const a of record.alternatives) nums.push(a.apy, a.score);
  if (record.fees) nums.push(record.fees.entryNetworkFeeLamports / LAMPORTS_PER_SOL, record.fees.exitNetworkFeeLamports / LAMPORTS_PER_SOL, record.fees.refundableRentLamports / LAMPORTS_PER_SOL);
  for (const s of record.supportingData) {
    const m = s.value.match(/-?\d+(?:\.\d+)?/);
    if (m) nums.push(Number(m[0]));
  }
  return nums;
}
