import {
  PublicKey,
  StakeInstruction,
  StakeProgram,
  SystemInstruction,
  TransactionInstruction,
  type MessageAccountKeys,
  type VersionedTransaction,
} from "@solana/web3.js";
import { KAMINO, LAMPORTS_PER_SOL, MINTS, PROGRAM_IDS } from "../constants";

/**
 * Instruction-level verification of a transaction BEFORE it is shown for signing.
 * Runs on the server (after building) and again in the browser (before the wallet
 * prompt). Any program or instruction not explicitly allowed is rejected.
 */

export type ExpectedTx =
  | {
      kind: "kamino-deposit";
      wallet: string;
      market: string;
      reserve: string;
      mint: string;
      /** Deposit amount in base units (lamports for SOL, 1e-6 for USDC). */
      amountBaseUnits: bigint;
      maxPriorityFeeLamports: number;
    }
  | {
      kind: "native-stake";
      wallet: string;
      stakeAccount: string;
      voteAccount: string;
      /** Total lamports funded into the stake account (delegation + rent reserve). */
      lamports: number;
      maxPriorityFeeLamports: number;
    };

export interface VerificationSummary {
  programs: string[];
  instructionCount: number;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: number;
  /** Upper bound of priority fee in lamports. */
  priorityFeeLamports: number;
  signaturesRequired: number;
}

export interface VerificationResult {
  ok: boolean;
  violations: string[];
  summary: VerificationSummary;
}

const ALLOWED_PROGRAMS: Record<ExpectedTx["kind"], Set<string>> = {
  "kamino-deposit": new Set([PROGRAM_IDS.computeBudget, PROGRAM_IDS.system, PROGRAM_IDS.associatedToken, PROGRAM_IDS.splToken, PROGRAM_IDS.addressLookupTable, PROGRAM_IDS.kaminoLend]),
  "native-stake": new Set([PROGRAM_IDS.computeBudget, PROGRAM_IDS.system, PROGRAM_IDS.stake]),
};

const MAX_COMPUTE_UNITS = 1_400_000;

export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string = PROGRAM_IDS.splToken): string {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(PROGRAM_IDS.associatedToken))[0].toBase58();
}

function readU32(d: Uint8Array, o: number) {
  return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true);
}
function readU64(d: Uint8Array, o: number): bigint {
  return new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
}

export function verifyTransaction(tx: VersionedTransaction, keys: MessageAccountKeys, expected: ExpectedTx): VerificationResult {
  const violations: string[] = [];
  const msg = tx.message;
  const allowed = ALLOWED_PROGRAMS[expected.kind];
  const wallet = expected.wallet;
  const key = (i: number) => keys.get(i)?.toBase58() ?? "<unresolved>";

  // --- Signers and fee payer
  if (msg.header.numRequiredSignatures !== 1) violations.push(`Transaction requires ${msg.header.numRequiredSignatures} signatures; only the connected wallet may sign.`);
  if (key(0) !== wallet) violations.push("Fee payer is not the connected wallet.");

  // Every account that must sign must be the wallet.
  for (let i = 0; i < msg.header.numRequiredSignatures; i++) if (key(i) !== wallet) violations.push(`Unexpected signer ${key(i)}.`);

  let cuLimit: number | null = null;
  let cuPrice = 0;
  let sawKaminoDeposit = false;
  let sawStakeCreate = false;
  let sawStakeInit = false;
  let sawDelegate = false;
  const programs = new Set<string>();
  const wsolAta = associatedTokenAddress(wallet, MINTS.wSOL);

  for (const [n, cix] of msg.compiledInstructions.entries()) {
    const programId = key(cix.programIdIndex);
    programs.add(programId);
    const where = `Instruction #${n + 1}`;
    if (!allowed.has(programId)) {
      violations.push(`${where} invokes program ${programId}, which is not on the allowlist for this action.`);
      continue;
    }
    const data = cix.data;
    const accts = cix.accountKeyIndexes.map(key);
    const ix = new TransactionInstruction({
      programId: new PublicKey(programId),
      keys: cix.accountKeyIndexes.map((i) => ({ pubkey: keys.get(i) ?? PublicKey.default, isSigner: msg.isAccountSigner(i), isWritable: msg.isAccountWritable(i) })),
      data: Buffer.from(data),
    });

    try {
      switch (programId) {
        case PROGRAM_IDS.computeBudget: {
          const t = data[0];
          if (t === 2) cuLimit = readU32(data, 1);
          else if (t === 3) cuPrice = Number(readU64(data, 1));
          else if (t !== 1 && t !== 4) violations.push(`${where}: unsupported ComputeBudget instruction ${t}.`);
          break;
        }
        case PROGRAM_IDS.system: {
          const type = SystemInstruction.decodeInstructionType(ix);
          if (expected.kind === "kamino-deposit" && type === "Transfer") {
            const t = SystemInstruction.decodeTransfer(ix);
            const max = expected.amountBaseUnits + BigInt(Math.max(10_000_000, Number(expected.amountBaseUnits / 50n)));
            if (t.fromPubkey.toBase58() !== wallet) violations.push(`${where}: SOL transfer is not from the wallet.`);
            if (t.toPubkey.toBase58() !== wsolAta) violations.push(`${where}: SOL transfer destination ${t.toPubkey.toBase58()} is not the wallet's own wrapped-SOL account.`);
            if (expected.mint !== MINTS.wSOL) violations.push(`${where}: unexpected SOL transfer in a non-SOL deposit.`);
            if (t.lamports > max) violations.push(`${where}: SOL transfer of ${Number(t.lamports) / LAMPORTS_PER_SOL} SOL exceeds the requested amount.`);
          } else if (expected.kind === "native-stake" && type === "CreateWithSeed") {
            const c = SystemInstruction.decodeCreateWithSeed(ix);
            if (c.fromPubkey.toBase58() !== wallet || c.basePubkey.toBase58() !== wallet) violations.push(`${where}: stake account must be funded and derived from the wallet.`);
            if (c.newAccountPubkey.toBase58() !== expected.stakeAccount) violations.push(`${where}: unexpected new account ${c.newAccountPubkey.toBase58()}.`);
            if (!c.programId.equals(StakeProgram.programId)) violations.push(`${where}: new account owner is not the Stake program.`);
            if (c.lamports !== expected.lamports) violations.push(`${where}: funded amount ${c.lamports} lamports does not match the previewed ${expected.lamports}.`);
            if (c.space !== StakeProgram.space) violations.push(`${where}: unexpected stake account size.`);
            sawStakeCreate = true;
          } else {
            violations.push(`${where}: System instruction "${type}" is not allowed for this action.`);
          }
          break;
        }
        case PROGRAM_IDS.associatedToken: {
          const t = data.length === 0 ? 0 : data[0];
          if (t !== 0 && t !== 1) violations.push(`${where}: unsupported associated-token instruction ${t}.`);
          else if (accts[0] !== wallet || accts[2] !== wallet) violations.push(`${where}: token account must be paid for and owned by the wallet.`);
          else if (expected.kind !== "kamino-deposit" || (accts[3] !== expected.mint && accts[3] !== MINTS.wSOL)) violations.push(`${where}: unexpected token mint ${accts[3]}.`);
          break;
        }
        case PROGRAM_IDS.splToken: {
          const t = data[0];
          if (t === 17) {
            if (accts[0] !== wsolAta) violations.push(`${where}: SyncNative on an account that is not the wallet's wrapped-SOL account.`);
          } else if (t === 9) {
            if (accts[0] !== wsolAta || accts[1] !== wallet || accts[2] !== wallet) violations.push(`${where}: CloseAccount must close the wallet's wrapped-SOL account back to the wallet.`);
          } else violations.push(`${where}: SPL Token instruction ${t} is not allowed (only wrap/unwrap SOL).`);
          break;
        }
        case PROGRAM_IDS.addressLookupTable: {
          const t = readU32(data, 0);
          if (t !== 0 && t !== 2) violations.push(`${where}: lookup-table instruction ${t} is not allowed.`);
          else if (accts[1] !== wallet) violations.push(`${where}: lookup table authority must be the wallet.`);
          else if (t === 0 && accts[2] !== wallet) violations.push(`${where}: lookup table payer must be the wallet.`);
          break;
        }
        case PROGRAM_IDS.kaminoLend: {
          // Kamino instructions may also refresh the user's other reserves, so only presence of the
          // target market + reserve is required here. Token movements are bounded by simulation checks.
          if (expected.kind === "kamino-deposit" && accts.includes(expected.market) && accts.includes(expected.reserve)) sawKaminoDeposit = true;
          if (expected.kind === "kamino-deposit" && expected.market !== KAMINO.mainMarket) violations.push(`${where}: market is not the configured Kamino Main Market.`);
          break;
        }
        case PROGRAM_IDS.stake: {
          if (expected.kind !== "native-stake") break;
          const type = StakeInstruction.decodeInstructionType(ix);
          if (type === "Initialize") {
            const init = StakeInstruction.decodeInitialize(ix);
            if (init.stakePubkey.toBase58() !== expected.stakeAccount) violations.push(`${where}: initializes an unexpected stake account.`);
            if (init.authorized.staker.toBase58() !== wallet || init.authorized.withdrawer.toBase58() !== wallet) violations.push(`${where}: stake and withdraw authority must both be the wallet.`);
            if (init.lockup && (init.lockup.epoch !== 0 || init.lockup.unixTimestamp !== 0 || !init.lockup.custodian.equals(PublicKey.default))) violations.push(`${where}: stake account must not have a lockup.`);
            sawStakeInit = true;
          } else if (type === "Delegate") {
            const d = StakeInstruction.decodeDelegate(ix);
            if (d.stakePubkey.toBase58() !== expected.stakeAccount) violations.push(`${where}: delegates an unexpected stake account.`);
            if (d.votePubkey.toBase58() !== expected.voteAccount) violations.push(`${where}: delegates to ${d.votePubkey.toBase58()}, not the reviewed validator.`);
            if (d.authorizedPubkey.toBase58() !== wallet) violations.push(`${where}: delegation authority must be the wallet.`);
            sawDelegate = true;
          } else violations.push(`${where}: Stake instruction "${type}" is not allowed for this action.`);
          break;
        }
      }
    } catch (e) {
      violations.push(`${where}: could not decode instruction for program ${programId} (${e instanceof Error ? e.message : String(e)}).`);
    }
  }

  if (expected.kind === "kamino-deposit" && !sawKaminoDeposit) violations.push("No Kamino Lend instruction references the expected market and reserve.");
  if (expected.kind === "native-stake" && !(sawStakeCreate && sawStakeInit && sawDelegate)) violations.push("Stake transaction must create, initialize, and delegate exactly the reviewed stake account.");

  const effectiveLimit = cuLimit ?? MAX_COMPUTE_UNITS;
  if (cuLimit !== null && cuLimit > MAX_COMPUTE_UNITS) violations.push(`Compute unit limit ${cuLimit} exceeds the maximum.`);
  const priorityFeeLamports = Math.ceil((effectiveLimit * cuPrice) / 1_000_000);
  if (priorityFeeLamports > expected.maxPriorityFeeLamports) violations.push(`Priority fee up to ${priorityFeeLamports} lamports exceeds the configured cap of ${expected.maxPriorityFeeLamports}.`);

  return {
    ok: violations.length === 0,
    violations,
    summary: {
      programs: [...programs],
      instructionCount: msg.compiledInstructions.length,
      computeUnitLimit: cuLimit,
      computeUnitPriceMicroLamports: cuPrice,
      priorityFeeLamports,
      signaturesRequired: msg.header.numRequiredSignatures,
    },
  };
}
