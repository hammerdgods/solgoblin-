import type { Connection } from "@solana/web3.js";
import { BASE_FEE_LAMPORTS_PER_SIGNATURE, FALLBACK_EPOCHS_PER_YEAR, isTestNetwork, LAMPORTS_PER_SOL, STAKE_ACCOUNT_SPACE, type SolanaNetwork } from "../constants";
import { memoize } from "../solana/rpc";
import type { AdapterContext, AdapterResult, Opportunity, RiskFactor, YieldAdapter } from "../types";
import { aprToApy } from "../yield/math";

/**
 * Native SOL staking adapter (LIVE, derived from Solana RPC).
 *
 * Estimated validator-network staking APR =
 *   validator inflation rate × total supply ÷ total activated stake
 * then reduced by the validator's inflation-reward commission and compounded per epoch.
 * Excludes MEV / block-reward sharing and assumes the validator earns full vote credits.
 */

export interface VoteAccountInfo {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: number; // lamports
  /** Inflation rewards commission in [0, 1]. */
  commission: number;
  delinquent: boolean;
  lastVote: number;
}

export interface StakingNetworkSnapshot {
  validatorInflationRate: number;
  totalSupplyLamports: number;
  totalActiveStakeLamports: number;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  secondsPerSlot: number;
  minimumDelegationLamports: number;
  stakeAccountRentLamports: number;
  voteAccounts: VoteAccountInfo[];
}

export function grossStakingApr(s: Pick<StakingNetworkSnapshot, "validatorInflationRate" | "totalSupplyLamports" | "totalActiveStakeLamports">): number {
  if (!(s.totalActiveStakeLamports > 0)) throw new RangeError("total active stake must be > 0");
  return (s.validatorInflationRate * s.totalSupplyLamports) / s.totalActiveStakeLamports;
}

export function epochsPerYear(s: Pick<StakingNetworkSnapshot, "slotsInEpoch" | "secondsPerSlot">): number {
  const epochSeconds = s.slotsInEpoch * s.secondsPerSlot;
  if (!(epochSeconds > 0)) return FALLBACK_EPOCHS_PER_YEAR;
  return (365 * 24 * 3600) / epochSeconds;
}

export function validatorNetApy(snapshot: StakingNetworkSnapshot, commission: number): { apr: number; apy: number } {
  const c = Math.min(1, Math.max(0, commission));
  const apr = grossStakingApr(snapshot) * (1 - c);
  return { apr, apy: aprToApy(apr, epochsPerYear(snapshot)) };
}

export function hoursUntilNextEpoch(s: Pick<StakingNetworkSnapshot, "slotsInEpoch" | "slotIndex" | "secondsPerSlot">): number {
  return (Math.max(0, s.slotsInEpoch - s.slotIndex) * s.secondsPerSlot) / 3600;
}

export interface ValidatorSelection {
  validators: VoteAccountInfo[];
  /** "allowlist" when chosen from trusted config, "auto-test" for the devnet/localnet fallback. */
  mode: "allowlist" | "auto-test" | "none";
  problems: string[];
}

/**
 * Picks validators the app may delegate to. Mainnet requires an explicit allowlist
 * (STAKE_VALIDATOR_VOTE_ACCOUNTS). On devnet, if none is configured, a deterministic
 * fallback picks the highest-stake non-delinquent validators with commission ≤ 10%.
 */
export function selectValidators(all: VoteAccountInfo[], allowlist: string[], network: SolanaNetwork, maxAuto = 3): ValidatorSelection {
  const problems: string[] = [];
  if (allowlist.length > 0) {
    const validators: VoteAccountInfo[] = [];
    for (const vote of allowlist) {
      const v = all.find((x) => x.votePubkey === vote);
      if (!v) problems.push(`Allowlisted validator ${vote} was not found among current vote accounts.`);
      else if (v.delinquent) problems.push(`Allowlisted validator ${vote} is currently delinquent; excluded.`);
      else validators.push(v);
    }
    return { validators, mode: "allowlist", problems };
  }
  if (isTestNetwork(network)) {
    const validators = all
      .filter((v) => !v.delinquent && v.commission <= 0.1 && v.activatedStake > 0)
      .sort((a, b) => b.activatedStake - a.activatedStake || a.votePubkey.localeCompare(b.votePubkey))
      .slice(0, maxAuto);
    return { validators, mode: "auto-test", problems };
  }
  problems.push("No validator allowlist configured (STAKE_VALIDATOR_VOTE_ACCOUNTS). Mainnet staking transactions are disabled until one is set.");
  return { validators: [], mode: "none", problems };
}

function stakingRisks(v: VoteAccountInfo | null): RiskFactor[] {
  return [
    {
      id: "validator-performance",
      level: "low",
      title: "Validator performance",
      detail: "Rewards depend on the validator voting reliably. Downtime or delinquency reduces rewards; the estimate assumes full vote credits.",
    },
    {
      id: "commission-change",
      level: "low",
      title: "Commission can change",
      detail: v ? `Current commission is ${(v.commission * 100).toFixed(1)}%. Validators can raise commission at any time, lowering your rewards.` : "Validators can raise commission at any time.",
    },
    {
      id: "slashing",
      level: "low",
      title: "Slashing / protocol changes",
      detail: "Solana does not currently slash stake automatically, but protocol rules can change.",
    },
    {
      id: "liquidity",
      level: "medium",
      title: "Unstaking delay",
      detail: "Stake activates and deactivates at epoch boundaries (~2–3 days each). Funds cannot be withdrawn until deactivation completes.",
    },
    {
      id: "price",
      level: "medium",
      title: "SOL price exposure",
      detail: "Rewards are paid in SOL. The USD value of your position moves with SOL's price; price changes are not yield.",
    },
  ];
}

export function stakingOpportunities(snapshot: StakingNetworkSnapshot, selection: ValidatorSelection, network: SolanaNetwork, fetchedAt: Date, rpcLabel: string): Opportunity[] {
  const warmupHours = hoursUntilNextEpoch(snapshot);
  const epochHours = (snapshot.slotsInEpoch * snapshot.secondsPerSlot) / 3600;
  const base = {
    protocol: "Solana native staking",
    kind: "native-staking" as const,
    asset: "SOL" as const,
    network,
    rateType: "staking-apy" as const,
    source: { kind: "live" as const, name: `Solana RPC (${rpcLabel}): inflation, supply, vote accounts`, fetchedAt: fetchedAt.toISOString() },
    liquidity: {
      depositDescription: `Create a stake account funded from your wallet and delegate it. Activation begins at the next epoch boundary (~${warmupHours.toFixed(1)}h).`,
      withdrawalDescription: `Deactivate, wait until the end of the epoch (up to ~${epochHours.toFixed(0)}h, longer if network-wide cooldown limits apply), then withdraw.`,
      withdrawalDelayHours: epochHours,
      minimumDeposit: snapshot.minimumDelegationLamports / LAMPORTS_PER_SOL,
      minimumDepositNote: "Minimum delegation reported by RPC (getStakeMinimumDelegation), excluding the stake account rent reserve.",
    },
    costs: {
      entryNetworkFeeLamports: BASE_FEE_LAMPORTS_PER_SIGNATURE,
      exitNetworkFeeLamports: 2 * BASE_FEE_LAMPORTS_PER_SIGNATURE,
      refundableRentLamports: snapshot.stakeAccountRentLamports,
      protocolFeeRate: 0,
      notes: [
        `The stake account must hold a rent-exempt reserve of ${(snapshot.stakeAccountRentLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL, returned when the account is withdrawn/closed. It does not earn rewards.`,
        "Exit requires two transactions (deactivate, then withdraw).",
      ],
    },
    rateNotes: [
      "Estimated from on-chain inflation and stake data; not reported by a protocol.",
      "Excludes MEV and block-reward sharing; assumes the validator earns full vote credits.",
      "Inflation declines over time per Solana's schedule, so this estimate drifts downward.",
      ...(isTestNetwork(network) ? [`${network} rewards are not representative of mainnet and have no monetary value.`] : []),
    ],
    metrics: {
      grossApr: grossStakingApr(snapshot),
      epoch: snapshot.epoch,
      epochsPerYear: epochsPerYear(snapshot),
      warmupHours,
      totalActiveStakeSol: snapshot.totalActiveStakeLamports / LAMPORTS_PER_SOL,
    },
  };

  if (selection.validators.length === 0) {
    const commissions = snapshot.voteAccounts.filter((v) => !v.delinquent).map((v) => v.commission).sort((a, b) => a - b);
    const median = commissions.length ? commissions[Math.floor(commissions.length / 2)] : 0.05;
    const { apr, apy } = validatorNetApy(snapshot, median);
    return [
      {
        ...base,
        id: `native-stake-${network}-reference`,
        strategyName: "Native staking (reference: median validator commission)",
        apy,
        apr,
        risks: stakingRisks(null),
        riskLevel: "low",
        executable: false,
        executableReason: selection.problems.join(" ") || "No eligible validator configured.",
        metrics: { ...base.metrics, commission: median },
        refs: {},
      },
    ];
  }

  return selection.validators.map((v) => {
    const { apr, apy } = validatorNetApy(snapshot, v.commission);
    return {
      ...base,
      id: `native-stake-${network}-${v.votePubkey}`,
      strategyName: `Native staking — validator ${v.votePubkey.slice(0, 4)}…${v.votePubkey.slice(-4)}`,
      apy,
      apr,
      risks: stakingRisks(v),
      riskLevel: "low" as const,
      executable: true,
      executableReason: selection.mode === "auto-test" ? `${network} validator auto-selected (highest stake, commission ≤ 10%). Configure STAKE_VALIDATOR_VOTE_ACCOUNTS to pin validators.` : undefined,
      metrics: { ...base.metrics, commission: v.commission, activatedStakeSol: v.activatedStake / LAMPORTS_PER_SOL },
      refs: { voteAccount: v.votePubkey, selectionMode: selection.mode },
    };
  });
}

/** Commission in [0,1]; prefers the bps field when the RPC reports it. */
function parseCommission(raw: { commission: number; inflationRewardsCommissionBps?: number | null }): number {
  if (typeof raw.inflationRewardsCommissionBps === "number") return raw.inflationRewardsCommissionBps / 10_000;
  return raw.commission / 100;
}

export async function fetchStakingSnapshot(connection: Connection): Promise<StakingNetworkSnapshot> {
  const [inflation, supply, voteAccounts, epochInfo, perf, minDelegation, rent] = await Promise.all([
    connection.getInflationRate(),
    connection.getSupply({ excludeNonCirculatingAccountsList: true }),
    connection.getVoteAccounts(),
    connection.getEpochInfo(),
    connection.getRecentPerformanceSamples(10),
    connection.getStakeMinimumDelegation(),
    connection.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE),
  ]);
  type RawVote = (typeof voteAccounts.current)[number] & { inflationRewardsCommissionBps?: number | null };
  const toInfo = (v: RawVote, delinquent: boolean): VoteAccountInfo => ({
    votePubkey: v.votePubkey,
    nodePubkey: v.nodePubkey,
    activatedStake: Number(v.activatedStake),
    commission: parseCommission(v),
    delinquent,
    lastVote: v.lastVote,
  });
  const all = [...voteAccounts.current.map((v) => toInfo(v, false)), ...voteAccounts.delinquent.map((v) => toInfo(v, true))];
  const totalActiveStakeLamports = voteAccounts.current.reduce((s, v) => s + Number(v.activatedStake), 0) + voteAccounts.delinquent.reduce((s, v) => s + Number(v.activatedStake), 0);
  const slots = perf.reduce((s, p) => s + p.numSlots, 0);
  const secs = perf.reduce((s, p) => s + p.samplePeriodSecs, 0);
  const secondsPerSlot = slots > 0 && secs > 0 ? secs / slots : 0.4;
  return {
    validatorInflationRate: inflation.validator,
    totalSupplyLamports: Number(supply.value.total),
    totalActiveStakeLamports,
    epoch: epochInfo.epoch,
    slotIndex: epochInfo.slotIndex,
    slotsInEpoch: epochInfo.slotsInEpoch,
    secondsPerSlot,
    minimumDelegationLamports: Number(minDelegation.value),
    stakeAccountRentLamports: rent,
    voteAccounts: all,
  };
}

export function createNativeStakingAdapter(opts: { connection: Connection; validatorAllowlist: string[]; rpcLabel: string; cacheMs?: number }): YieldAdapter & { snapshot: () => Promise<StakingNetworkSnapshot> } {
  const memo = memoize(opts.cacheMs ?? 60_000, () => fetchStakingSnapshot(opts.connection));
  return {
    id: "native-staking",
    kind: "live",
    snapshot: () => memo.get(),
    async fetchOpportunities(ctx: AdapterContext): Promise<AdapterResult> {
      try {
        const snap = await memo.get();
        const selection = selectValidators(snap.voteAccounts, opts.validatorAllowlist, ctx.network);
        return { adapterId: "native-staking", opportunities: stakingOpportunities(snap, selection, ctx.network, ctx.now, opts.rpcLabel), errors: selection.problems };
      } catch (e) {
        return { adapterId: "native-staking", opportunities: [], errors: [`Staking data unavailable from RPC: ${e instanceof Error ? e.message : String(e)}`] };
      }
    },
  };
}
