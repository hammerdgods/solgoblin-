/**
 * Deterministic yield math. No randomness, no network, no AI.
 * All rates are fractions (0.05 = 5%).
 */

export const DAYS_PER_YEAR = 365;

function assertFiniteRate(rate: number, name: string): void {
  if (!Number.isFinite(rate)) throw new RangeError(`${name} must be a finite number`);
  if (rate <= -1) throw new RangeError(`${name} must be greater than -100%`);
}

/** Convert APR to APY given compounding periods per year. */
export function aprToApy(apr: number, periodsPerYear: number): number {
  assertFiniteRate(apr, "apr");
  if (!(periodsPerYear > 0)) throw new RangeError("periodsPerYear must be > 0");
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}

/** Convert APY to APR given compounding periods per year. */
export function apyToApr(apy: number, periodsPerYear: number): number {
  assertFiniteRate(apy, "apy");
  if (!(periodsPerYear > 0)) throw new RangeError("periodsPerYear must be > 0");
  return periodsPerYear * (Math.pow(1 + apy, 1 / periodsPerYear) - 1);
}

/**
 * Gross yield in asset units over `days`, assuming the APY stays constant
 * (it will not — this is an estimate) and compounding is captured by the APY.
 */
export function grossYieldForPeriod(principal: number, apy: number, days: number): number {
  assertFiniteRate(apy, "apy");
  if (!(principal >= 0)) throw new RangeError("principal must be >= 0");
  if (!(days >= 0)) throw new RangeError("days must be >= 0");
  return principal * (Math.pow(1 + apy, days / DAYS_PER_YEAR) - 1);
}

export interface NetYieldInput {
  /** Amount deposited, in asset units. */
  principal: number;
  apy: number;
  days: number;
  /** Fraction of the principal charged by the protocol on entry. */
  protocolFeeRate: number;
  /** Network fees (entry + exit) expressed in asset units. */
  networkFeesInAsset: number;
  /** Days before the position starts earning (e.g. stake warm-up). */
  warmupDays?: number;
}

export interface NetYieldEstimate {
  principal: number;
  days: number;
  earningDays: number;
  grossYield: number;
  protocolFee: number;
  networkFees: number;
  netYield: number;
  /** Net yield over the period, annualized as a simple rate; null when days = 0 or principal = 0. */
  effectiveAnnualRate: number | null;
  /** Days until net yield covers costs at this APY; null if never. */
  breakEvenDays: number | null;
}

/** Fee-adjusted net-yield estimate. Deterministic and side-effect free. */
export function estimateNetYield(input: NetYieldInput): NetYieldEstimate {
  const { principal, apy, days, protocolFeeRate, networkFeesInAsset } = input;
  const warmupDays = Math.max(0, input.warmupDays ?? 0);
  if (!(protocolFeeRate >= 0 && protocolFeeRate < 1)) throw new RangeError("protocolFeeRate must be in [0, 1)");
  if (!(networkFeesInAsset >= 0)) throw new RangeError("networkFeesInAsset must be >= 0");

  const protocolFee = principal * protocolFeeRate;
  const invested = principal - protocolFee;
  const earningDays = Math.max(0, days - warmupDays);
  const grossYield = grossYieldForPeriod(invested, apy, earningDays);
  const netYield = grossYield - protocolFee - networkFeesInAsset;

  const effectiveAnnualRate = days > 0 && principal > 0 ? (netYield / principal) * (DAYS_PER_YEAR / days) : null;

  const costs = protocolFee + networkFeesInAsset;
  let breakEvenDays: number | null = null;
  if (costs === 0) breakEvenDays = 0;
  else if (apy > 0 && invested > 0) {
    // Solve invested * ((1+apy)^(t/365) - 1) = costs for t, then add warm-up.
    const t = (DAYS_PER_YEAR * Math.log(1 + costs / invested)) / Math.log(1 + apy);
    breakEvenDays = Number.isFinite(t) ? t + warmupDays : null;
  }

  return { principal, days, earningDays, grossYield, protocolFee, networkFees: networkFeesInAsset, netYield, effectiveAnnualRate, breakEvenDays };
}

/** Difference between two rates in basis points. */
export function rateDeltaBps(previous: number, current: number): number {
  return Math.round((current - previous) * 10_000);
}
