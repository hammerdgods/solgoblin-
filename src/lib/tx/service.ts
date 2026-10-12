import "server-only";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { createHash, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { getServerConfig } from "../config/server";
import { KAMINO, LAMPORTS_PER_SOL, MINTS, type KaminoReserveKey } from "../constants";
import { ApiError } from "../http/api";
import { log } from "../log";
import { getStakingAdapter, getStore, requireNetwork, scanOpportunities, serverConnection } from "../server/services";
import { getWalletBalances } from "../solana/portfolio";
import { verifyRpcNetwork } from "../solana/rpc";
import { associatedTokenAddress, verifyTransaction, type ExpectedTx, type VerificationSummary } from "../solana/verify";
import type { TransactionEventRow, TxAction } from "../store/types";
import type { Opportunity, RiskFactor } from "../types";
import { classifyFreshness } from "../yield/freshness";
import { buildKaminoDepositTx, buildNativeStakeTx, formatAmountForApi, stakeSeed, toBaseUnits, type BuiltTransaction } from "./build";
import { classifyConfirmedTransaction, classifySignatureStatus } from "./confirm";
import { checkBalances, checkTxPolicy, KAMINO_MAX_SOL_OVERHEAD, rateChangedBeyond, stakeOverheadSol } from "./policy";

/** A prepared intent is valid for at most this long, or until its blockhash expires. */
export const INTENT_TTL_MS = 90_000;
const RATE_DRIFT_TOLERANCE_BPS = 25;

export interface TxPreview {
  intentId: string;
  action: TxAction;
  network: string;
  wallet: string;
  opportunityId: string;
  protocol: string;
  strategyName: string;
  asset: "SOL" | "USDC";
  amount: number;
  apyAtPreview: number;
  rateType: string;
  expectedPosition: string;
  costs: {
    networkFeeLamports: number;
    priorityFeeLamports: number;
    /** SOL leaving the wallet according to simulation (includes deposit if SOL, fee, rent). */
    simulatedSolOutflowLamports: number | null;
    /** USDC leaving the wallet according to simulation. */
    simulatedUsdcOutflow: number | null;
    refundableRentLamports: number;
    notes: string[];
  };
  simulation: { ok: boolean; unitsConsumed: number | null; error: string | null; logsTail: string[] };
  verification: VerificationSummary;
  risks: RiskFactor[];
  warnings: string[];
  details: Record<string, string | number>;
  expiresAt: string;
  lastValidBlockHeight: number;
}

export interface PrepareInput {
  wallet: string;
  opportunityId: string;
  amount: number;
  reviewedApy: number;
}

function messageHash(tx: VersionedTransaction): string {
  return createHash("sha256").update(tx.message.serialize()).digest("hex");
}

function findOpportunity(ops: Opportunity[], id: string) {
  return ops.find((o) => o.id === id) ?? null;
}

export async function prepareTransaction(input: PrepareInput): Promise<{ preview: TxPreview; transaction: string }> {
  const cfg = getServerConfig();
  const network = requireNetwork();
  const connection = serverConnection();
  const store = await getStore();

  // 1. Fresh data (never trust what the client displayed).
  const [rpcCheck, scan] = await Promise.all([verifyRpcNetwork(connection, network), scanOpportunities("live", { force: true })]);
  const opportunity = findOpportunity(scan.opportunities, input.opportunityId);

  // 2. Policy gates.
  const blockers = checkTxPolicy({ config: cfg.tx, network, rpcNetworkOk: rpcCheck.ok, opportunity, amount: input.amount });
  if (blockers.length) throw new ApiError(403, "TX_BLOCKED", "Transaction preparation is blocked.", { blockers });
  const o = opportunity!;
  if (classifyFreshness(o.source, new Date(), cfg.monitoring.staleAfterSeconds) !== "fresh") throw new ApiError(409, "STALE_DATA", "Rate data is stale; refresh and review again.");
  // Drift is only meaningful for plausible rates; implausible ones carry a preview warning instead.
  const plausible = o.apy >= 0 && o.apy <= 1;
  if (plausible && rateChangedBeyond(input.reviewedApy, o.apy, RATE_DRIFT_TOLERANCE_BPS)) {
    throw new ApiError(409, "RATE_CHANGED", `The rate changed since you reviewed it (now ${(o.apy * 100).toFixed(3)}%). Review the updated numbers before continuing.`, { currentApy: o.apy });
  }

  // 3. Duplicate protection: no new deposit while another one is awaiting confirmation.
  const recent = await store.listTransactionEvents({ wallet: input.wallet, limit: 20 });
  const inflight = recent.find((e) => e.status === "submitted" && Date.now() - Date.parse(e.updated_at) < 3 * 60_000);
  if (inflight) throw new ApiError(409, "TX_IN_FLIGHT", "A previous transaction from this wallet is still awaiting confirmation. Wait for it to settle before starting another.", { intentId: inflight.id, signature: inflight.signature });

  const warnings: string[] = [];
  if (!(o.apy >= 0 && o.apy <= 1)) warnings.push("The displayed rate for this opportunity is outside plausible bounds and is not a meaningful estimate.");

  const intentId = randomUUID();
  const walletKey = new PublicKey(input.wallet);
  const balances = await getWalletBalances(connection, walletKey);

  let built: BuiltTransaction;
  let expected: ExpectedTx;
  let action: TxAction;
  let expectedPosition: string;
  let refundableRentLamports = 0;
  const details: Record<string, string | number> = {};

  if (o.kind === "native-staking") {
    const voteAccount = o.refs.voteAccount;
    if (!voteAccount) throw new ApiError(403, "TX_BLOCKED", "No validator configured for this opportunity.");
    const snap = await getStakingAdapter().snapshot();
    const delegationLamports = Math.round(input.amount * LAMPORTS_PER_SOL);
    if (delegationLamports < snap.minimumDelegationLamports) throw new ApiError(400, "BELOW_MINIMUM", `Minimum stake delegation is ${snap.minimumDelegationLamports / LAMPORTS_PER_SOL} SOL.`);
    refundableRentLamports = snap.stakeAccountRentLamports;
    const lamports = delegationLamports + refundableRentLamports;
    const problems = checkBalances({ asset: "SOL", amount: input.amount, solBalance: balances.sol, usdcBalance: balances.usdc, solOverhead: stakeOverheadSol(refundableRentLamports, 10_000), minSolReserve: cfg.tx.minSolReserve });
    if (problems.length) throw new ApiError(400, "INSUFFICIENT_BALANCE", problems.join(" "), { problems });
    const seed = stakeSeed(intentId.replace(/-/g, "").slice(0, 24));
    const s = await buildNativeStakeTx(connection, { wallet: input.wallet, voteAccount, lamports, seed });
    built = s;
    action = "native-stake";
    expected = { kind: "native-stake", wallet: input.wallet, stakeAccount: s.stakeAccount, voteAccount, lamports, maxPriorityFeeLamports: cfg.tx.maxPriorityFeeLamports };
    expectedPosition = `New stake account ${s.stakeAccount} holding ${input.amount} SOL delegated to validator ${voteAccount} (+${refundableRentLamports / LAMPORTS_PER_SOL} SOL refundable rent reserve). Activation starts at the next epoch boundary.`;
    Object.assign(details, { stakeAccount: s.stakeAccount, voteAccount, seed });
  } else {
    const key = o.asset as KaminoReserveKey;
    const reserve = KAMINO.reserves[key];
    if (o.refs.reserve !== reserve.address || o.refs.market !== KAMINO.mainMarket) throw new ApiError(403, "TX_BLOCKED", "Opportunity does not match the trusted Kamino configuration.");
    const problems = checkBalances({ asset: key, amount: input.amount, solBalance: balances.sol, usdcBalance: balances.usdc, solOverhead: 0.01, minSolReserve: cfg.tx.minSolReserve });
    if (problems.length) throw new ApiError(400, "INSUFFICIENT_BALANCE", problems.join(" "), { problems });
    built = await buildKaminoDepositTx(connection, { wallet: input.wallet, reserve: reserve.address, amount: formatAmountForApi(input.amount, reserve.decimals) });
    action = "kamino-deposit";
    expected = { kind: "kamino-deposit", wallet: input.wallet, market: KAMINO.mainMarket, reserve: reserve.address, mint: reserve.mint, amountBaseUnits: toBaseUnits(input.amount, reserve.decimals), maxPriorityFeeLamports: cfg.tx.maxPriorityFeeLamports };
    expectedPosition = `${input.amount} ${key} supplied to the Kamino Main Market ${key} reserve (${reserve.address}), held in your Kamino obligation and withdrawable subject to reserve liquidity.`;
    Object.assign(details, { market: KAMINO.mainMarket, reserve: reserve.address });
  }

  // 4. Instruction-level verification against trusted configuration.
  const keys = built.tx.message.getAccountKeys({ addressLookupTableAccounts: built.lookupTables });
  const verification = verifyTransaction(built.tx, keys, expected);
  if (!verification.ok) {
    log.warn("tx.prepare", "verification rejected transaction", { opportunityId: o.id, violations: verification.violations });
    throw new ApiError(422, "TX_VERIFICATION_FAILED", "The built transaction failed safety verification and will not be offered for signing.", { violations: verification.violations });
  }

  // 5. Simulation, with balance-delta bounds as a spending control.
  const sim = await simulateWithDeltas(connection, built.tx, input.wallet, o.asset === "USDC");
  if (!sim.ok) throw new ApiError(422, "SIMULATION_FAILED", `Transaction simulation failed: ${sim.error}`, { logsTail: sim.logsTail });
  const amountLamports = o.asset === "SOL" ? Math.round(input.amount * LAMPORTS_PER_SOL) : 0;
  if (sim.solOutflowLamports !== null) {
    const overhead = sim.solOutflowLamports - amountLamports - refundableRentLamports;
    if (overhead > KAMINO_MAX_SOL_OVERHEAD * LAMPORTS_PER_SOL) throw new ApiError(422, "SPENDING_LIMIT", `Simulation shows ${(overhead / LAMPORTS_PER_SOL).toFixed(6)} SOL of extra outflow, above the ${KAMINO_MAX_SOL_OVERHEAD} SOL cap.`);
    if (overhead > 0.005 * LAMPORTS_PER_SOL) warnings.push(`This transaction also spends about ${(overhead / LAMPORTS_PER_SOL).toFixed(6)} SOL on fees and one-time account rent (e.g. first-time Kamino account setup).`);
  }
  if (sim.usdcOutflow !== null && sim.usdcOutflow > input.amount + 1e-6) throw new ApiError(422, "SPENDING_LIMIT", `Simulation shows ${sim.usdcOutflow} USDC leaving the wallet, more than the requested ${input.amount}.`);

  const fee = (await connection.getFeeForMessage(built.tx.message, "confirmed")).value ?? 5000;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INTENT_TTL_MS).toISOString();

  const row: TransactionEventRow = {
    id: intentId,
    wallet: input.wallet,
    network,
    opportunity_id: o.id,
    action,
    asset: o.asset,
    amount: input.amount,
    status: "prepared",
    signature: null,
    fee_lamports: null,
    message_hash: messageHash(built.tx),
    last_valid_block_height: built.lastValidBlockHeight,
    error: null,
    details: { ...details, apyAtPreview: o.apy, expiresAt },
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await store.upsertTransactionEvent(row);

  const preview: TxPreview = {
    intentId,
    action,
    network,
    wallet: input.wallet,
    opportunityId: o.id,
    protocol: o.protocol,
    strategyName: o.strategyName,
    asset: o.asset,
    amount: input.amount,
    apyAtPreview: o.apy,
    rateType: o.rateType,
    expectedPosition,
    costs: {
      networkFeeLamports: fee,
      priorityFeeLamports: verification.summary.priorityFeeLamports,
      simulatedSolOutflowLamports: sim.solOutflowLamports,
      simulatedUsdcOutflow: sim.usdcOutflow,
      refundableRentLamports,
      notes: o.costs.notes,
    },
    simulation: { ok: true, unitsConsumed: sim.unitsConsumed, error: null, logsTail: sim.logsTail },
    verification: verification.summary,
    risks: o.risks,
    warnings,
    details,
    expiresAt,
    lastValidBlockHeight: built.lastValidBlockHeight,
  };
  return { preview, transaction: Buffer.from(built.tx.serialize()).toString("base64") };
}

interface SimResult {
  ok: boolean;
  error: string | null;
  unitsConsumed: number | null;
  logsTail: string[];
  solOutflowLamports: number | null;
  usdcOutflow: number | null;
}

async function simulateWithDeltas(connection: Connection, tx: VersionedTransaction, wallet: string, trackUsdc: boolean): Promise<SimResult> {
  const usdcAta = associatedTokenAddress(wallet, MINTS.USDC);
  const addresses = trackUsdc ? [wallet, usdcAta] : [wallet];
  const pre = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
  const res = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses } });
  const v = res.value;
  const logsTail = (v.logs ?? []).slice(-8);
  if (v.err) return { ok: false, error: typeof v.err === "string" ? v.err : JSON.stringify(v.err), unitsConsumed: v.unitsConsumed ?? null, logsTail, solOutflowLamports: null, usdcOutflow: null };
  const postWallet = v.accounts?.[0];
  const solOutflowLamports = postWallet && pre[0] ? pre[0].lamports - postWallet.lamports : null;
  let usdcOutflow: number | null = null;
  if (trackUsdc && pre[1] && v.accounts?.[1]) {
    const before = Buffer.from(pre[1].data).readBigUInt64LE(64);
    const after = Buffer.from(v.accounts[1].data[0], "base64").readBigUInt64LE(64);
    usdcOutflow = Number(before - after) / 1e6;
  }
  return { ok: true, error: null, unitsConsumed: v.unitsConsumed ?? null, logsTail, solOutflowLamports, usdcOutflow };
}

// In-process guard in addition to the store's compare-and-set.
const submitting = new Set<string>();

export async function submitSignedTransaction(intentId: string, signedBase64: string): Promise<{ signature: string; status: "submitted" }> {
  const cfg = getServerConfig();
  if (cfg.tx.killSwitch) throw new ApiError(403, "TX_BLOCKED", "Transactions are disabled by the emergency kill switch.");
  const store = await getStore();
  const row = await store.getTransactionEvent(intentId);
  if (!row) throw new ApiError(404, "INTENT_NOT_FOUND", "Unknown transaction intent.");
  if (row.status !== "prepared") throw new ApiError(409, "DUPLICATE_SUBMISSION", `This transaction was already ${row.status}. It will not be sent again.`, { status: row.status, signature: row.signature });
  if (Date.now() - Date.parse(row.created_at) > INTENT_TTL_MS) {
    await store.transitionTransactionEvent(intentId, "prepared", { status: "expired", error: "Preview expired before submission." });
    throw new ApiError(410, "INTENT_EXPIRED", "This preview expired. Prepare a new one and review it again.");
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  } catch {
    throw new ApiError(400, "INVALID_TRANSACTION", "Signed transaction could not be decoded.");
  }
  if (messageHash(tx) !== row.message_hash) throw new ApiError(422, "TX_MODIFIED", "The signed transaction differs from the reviewed preview (it may have been modified by the wallet). SolGoblin will not submit it.");
  const sig = tx.signatures[0];
  if (!sig || sig.every((b) => b === 0)) throw new ApiError(400, "UNSIGNED", "Transaction is not signed.");
  const valid = ed25519.verify(sig, tx.message.serialize(), new PublicKey(row.wallet).toBytes());
  if (!valid) throw new ApiError(400, "BAD_SIGNATURE", "Signature does not match the connected wallet.");
  const signature = bs58.encode(sig);

  if (submitting.has(intentId)) throw new ApiError(409, "DUPLICATE_SUBMISSION", "This transaction is already being submitted.");
  submitting.add(intentId);
  try {
    const claimed = await store.transitionTransactionEvent(intentId, "prepared", { status: "submitted", signature });
    if (!claimed) throw new ApiError(409, "DUPLICATE_SUBMISSION", "This transaction was already submitted.");
    try {
      await serverConnection().sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await store.transitionTransactionEvent(intentId, "submitted", { status: "failed", error: message.slice(0, 500) });
      throw new ApiError(422, "SEND_FAILED", `The network rejected the transaction: ${message.slice(0, 300)}`);
    }
    log.info("tx.submit", "submitted", { intentId, signature });
    return { signature, status: "submitted" };
  } finally {
    submitting.delete(intentId);
  }
}

export interface TxStatusResult {
  intentId: string;
  status: TransactionEventRow["status"] | "pending";
  signature: string | null;
  confirmationStatus: string | null;
  error: string | null;
  feeLamports: number | null;
}

/** Checks on-chain status. Only reports "confirmed" once the cluster confirms without error. */
export async function getTransactionStatus(intentId: string): Promise<TxStatusResult> {
  const store = await getStore();
  const row = await store.getTransactionEvent(intentId);
  if (!row) throw new ApiError(404, "INTENT_NOT_FOUND", "Unknown transaction intent.");
  const base = { intentId, signature: row.signature, error: row.error, feeLamports: row.fee_lamports };
  if (row.status !== "submitted" || !row.signature) return { ...base, status: row.status, confirmationStatus: null };

  const connection = serverConnection();
  const st = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
  const height = st ? null : await connection.getBlockHeight("confirmed");
  const decision = classifySignatureStatus(st, height, row.last_valid_block_height);
  if (decision.status === "needs-details") {
    const txInfo = await connection.getTransaction(row.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!txInfo?.meta) return { ...base, status: "pending", confirmationStatus: st?.confirmationStatus ?? null };
    const final = classifyConfirmedTransaction({ err: txInfo.meta.err, fee: txInfo.meta.fee });
    await store.transitionTransactionEvent(intentId, "submitted", { status: final.status, error: final.error, fee_lamports: final.feeLamports });
    return { ...base, status: final.status, confirmationStatus: st?.confirmationStatus ?? null, error: final.error, feeLamports: final.feeLamports };
  }
  if (decision.status === "failed" || decision.status === "expired") {
    await store.transitionTransactionEvent(intentId, "submitted", { status: decision.status, error: decision.error });
    return { ...base, status: decision.status, confirmationStatus: st?.confirmationStatus ?? null, error: decision.error };
  }
  return { ...base, status: "pending", confirmationStatus: st?.confirmationStatus ?? null };
}
