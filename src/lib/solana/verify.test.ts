import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { KAMINO, MINTS, PROGRAM_IDS } from "@/lib/constants";
import { buildNativeStakeTx, stakeSeed, toBaseUnits } from "@/lib/tx/build";
import { associatedTokenAddress, verifyTransaction, type ExpectedTx } from "./verify";

const BLOCKHASH = "EC6HiHvoifw9S2bDsJAg7k3ZUe2wAXAF1bgFUzck8PPS";
const fakeConnection = { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000 }) } as unknown as Connection;

const wallet = Keypair.generate().publicKey;
const vote = Keypair.generate().publicKey.toBase58();

async function stakeTx(lamports = 1_002_282_880) {
  const built = await buildNativeStakeTx(fakeConnection, { wallet: wallet.toBase58(), voteAccount: vote, lamports, seed: stakeSeed("abc") });
  const expected: ExpectedTx = { kind: "native-stake", wallet: wallet.toBase58(), stakeAccount: built.stakeAccount, voteAccount: vote, lamports, maxPriorityFeeLamports: 1000 };
  return { built, expected };
}

function compile(instructions: TransactionInstruction[], payer = wallet) {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message());
  return { tx, keys: tx.message.getAccountKeys() };
}

/** A Kamino-shaped deposit: compute budget + ATA create + KLend ix touching market and reserve. */
function kaminoLike(extra: TransactionInstruction[] = [], reserve: string = KAMINO.reserves.USDC.address, mint: string = MINTS.USDC) {
  const ata = new PublicKey(associatedTokenAddress(wallet.toBase58(), mint));
  const ataIx = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_IDS.associatedToken),
    keys: [wallet, ata, wallet, new PublicKey(mint), SystemProgram.programId, new PublicKey(PROGRAM_IDS.splToken)].map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i < 2 })),
    data: Buffer.from([1]),
  });
  const klend = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_IDS.kaminoLend),
    keys: [wallet, new PublicKey(KAMINO.mainMarket), new PublicKey(reserve)].map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i !== 1 })),
    data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
  });
  return compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ataIx, klend, ...extra]);
}
const kaminoExpected: ExpectedTx = { kind: "kamino-deposit", wallet: wallet.toBase58(), market: KAMINO.mainMarket, reserve: KAMINO.reserves.USDC.address, mint: MINTS.USDC, amountBaseUnits: toBaseUnits(25, 6), maxPriorityFeeLamports: 2_000_000 };

describe("native stake transaction verification", () => {
  it("accepts the transaction SolGoblin builds", async () => {
    const { built, expected } = await stakeTx();
    const r = verifyTransaction(built.tx, built.tx.message.getAccountKeys(), expected);
    expect(r.violations).toEqual([]);
    expect(r.summary.programs.sort()).toEqual([PROGRAM_IDS.stake, PROGRAM_IDS.system].sort());
  });
  it("accepts the legacy-format stake transaction built for legacy-only wallets", async () => {
    const built = await buildNativeStakeTx(fakeConnection, { wallet: wallet.toBase58(), voteAccount: vote, lamports: 1_002_282_880, seed: stakeSeed("abc"), legacy: true });
    const expected: ExpectedTx = { kind: "native-stake", wallet: wallet.toBase58(), stakeAccount: built.stakeAccount, voteAccount: vote, lamports: 1_002_282_880, maxPriorityFeeLamports: 1000 };
    const roundTrip = VersionedTransaction.deserialize(built.tx.serialize());
    expect(roundTrip.version).toBe("legacy");
    expect(verifyTransaction(roundTrip, roundTrip.message.getAccountKeys(), expected).violations).toEqual([]);
  });
  it("rejects a different validator, amount, or stake account", async () => {
    const { built, expected } = await stakeTx();
    const keys = built.tx.message.getAccountKeys();
    expect(verifyTransaction(built.tx, keys, { ...expected, voteAccount: Keypair.generate().publicKey.toBase58() }).ok).toBe(false);
    expect(verifyTransaction(built.tx, keys, { ...expected, lamports: expected.kind === "native-stake" ? expected.lamports - 1 : 0 }).ok).toBe(false);
    expect(verifyTransaction(built.tx, keys, { ...expected, stakeAccount: Keypair.generate().publicKey.toBase58() }).ok).toBe(false);
  });
  it("rejects a transfer to an attacker appended to an otherwise valid stake tx", async () => {
    const { expected } = await stakeTx();
    const create = StakeProgram.createAccountWithSeed({ fromPubkey: wallet, stakePubkey: new PublicKey((expected as { stakeAccount: string }).stakeAccount), basePubkey: wallet, seed: stakeSeed("abc"), authorized: { staker: wallet, withdrawer: wallet }, lamports: 1_002_282_880 } as never);
    const del = StakeProgram.delegate({ stakePubkey: new PublicKey((expected as { stakeAccount: string }).stakeAccount), authorizedPubkey: wallet, votePubkey: new PublicKey(vote) });
    const drain = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 5 });
    const { tx, keys } = compile([...create.instructions, ...del.instructions, drain]);
    const r = verifyTransaction(tx, keys, expected);
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/Transfer/);
  });
  it("rejects a stake account whose withdraw authority is not the wallet", async () => {
    const attacker = Keypair.generate().publicKey;
    const { expected } = await stakeTx();
    const stakePubkey = new PublicKey((expected as { stakeAccount: string }).stakeAccount);
    const create = StakeProgram.createAccountWithSeed({ fromPubkey: wallet, stakePubkey, basePubkey: wallet, seed: stakeSeed("abc"), authorized: { staker: wallet, withdrawer: attacker }, lamports: 1_002_282_880 } as never);
    const del = StakeProgram.delegate({ stakePubkey, authorizedPubkey: wallet, votePubkey: new PublicKey(vote) });
    const { tx, keys } = compile([...create.instructions, ...del.instructions]);
    expect(verifyTransaction(tx, keys, expected).violations.join(" ")).toMatch(/withdraw authority/);
  });
});

describe("Kamino deposit verification", () => {
  it("accepts a well-formed Kamino-style deposit", () => {
    const { tx, keys } = kaminoLike();
    expect(verifyTransaction(tx, keys, kaminoExpected).violations).toEqual([]);
  });
  it("rejects unknown programs", () => {
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
    const { tx, keys } = kaminoLike([evil]);
    expect(verifyTransaction(tx, keys, kaminoExpected).violations.join(" ")).toMatch(/not on the allowlist/);
  });
  it("rejects SPL token transfers/approvals", () => {
    const ata = new PublicKey(associatedTokenAddress(wallet.toBase58(), MINTS.USDC));
    const approve = new TransactionInstruction({ programId: new PublicKey(PROGRAM_IDS.splToken), keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, { pubkey: wallet, isSigner: true, isWritable: false }], data: Buffer.from([4, 1, 0, 0, 0, 0, 0, 0, 0]) });
    const { tx, keys } = kaminoLike([approve]);
    expect(verifyTransaction(tx, keys, kaminoExpected).violations.join(" ")).toMatch(/only wrap\/unwrap/);
  });
  it("rejects a deposit into a different reserve than reviewed", () => {
    const { tx, keys } = kaminoLike([], KAMINO.reserves.SOL.address);
    expect(verifyTransaction(tx, keys, kaminoExpected).ok).toBe(false);
  });
  it("rejects a SOL transfer to anyone but the wallet's own wrapped-SOL account", () => {
    const solExpected: ExpectedTx = { ...kaminoExpected, reserve: KAMINO.reserves.SOL.address, mint: MINTS.wSOL, amountBaseUnits: toBaseUnits(0.1, 9) } as ExpectedTx;
    const wsol = new PublicKey(associatedTokenAddress(wallet.toBase58(), MINTS.wSOL));
    const ok = kaminoLike([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 100_000_000 })], KAMINO.reserves.SOL.address, MINTS.wSOL);
    expect(verifyTransaction(ok.tx, ok.keys, solExpected).violations).toEqual([]);
    const tooMuch = kaminoLike([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: wsol, lamports: 900_000_000 })], KAMINO.reserves.SOL.address, MINTS.wSOL);
    expect(verifyTransaction(tooMuch.tx, tooMuch.keys, solExpected).violations.join(" ")).toMatch(/exceeds the requested amount/);
    const elsewhere = kaminoLike([SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 })], KAMINO.reserves.SOL.address, MINTS.wSOL);
    expect(verifyTransaction(elsewhere.tx, elsewhere.keys, solExpected).violations.join(" ")).toMatch(/not the wallet's own wrapped-SOL/);
  });
  it("enforces the priority fee cap", () => {
    const { tx, keys } = kaminoLike([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000 })]);
    expect(verifyTransaction(tx, keys, kaminoExpected).violations.join(" ")).toMatch(/Priority fee/);
  });
  it("rejects lookup tables with a foreign authority", () => {
    const [ix] = AddressLookupTableProgram.createLookupTable({ authority: Keypair.generate().publicKey, payer: wallet, recentSlot: 1 });
    const { tx, keys } = kaminoLike([ix]);
    expect(verifyTransaction(tx, keys, kaminoExpected).violations.join(" ")).toMatch(/authority must be the wallet/);
  });
  it("rejects a different fee payer or extra signers", () => {
    const { tx, keys } = kaminoLike();
    expect(verifyTransaction(tx, keys, { ...kaminoExpected, wallet: Keypair.generate().publicKey.toBase58() }).violations.join(" ")).toMatch(/Fee payer/);
  });
});
