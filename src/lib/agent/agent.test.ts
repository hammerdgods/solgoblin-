import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { demoOpportunities } from "@/lib/adapters/demo";
import { rankOpportunities, RISK_PROFILES } from "@/lib/scanner/rank";
import { makeOpportunity } from "@/test/fixtures";
import { buildDeterministicDecision, type DecisionInput } from "./deterministic";
import { explainWithLlm, factsForLlm, validateLlmOutput, type LlmClient } from "./llm";
import { checkNumbers, extractNumbers } from "./numericGuard";
import { recommend } from "./recommend";
import { decisionRecordSchema } from "./schema";

const now = new Date("2026-06-01T12:00:00Z");
const ops = [
  makeOpportunity({ id: "kamino-usdc", apy: 0.0474, riskLevel: "medium", metrics: { utilization: 0.9 } }, now),
  makeOpportunity({ id: "risky-usdc", apy: 0.15, riskLevel: "high" }, now),
  makeOpportunity({ id: "stake", asset: "SOL", kind: "native-staking", rateType: "staking-apy", apy: 0.06, riskLevel: "low" }, now),
];
const input: DecisionInput = { id: "rec-1", asset: "USDC", amount: 500, wallet: null, preferences: RISK_PROFILES.balanced, mode: "live", network: "mainnet-beta", now, staleAfterSeconds: 900, prices: {} };
const ranked = () => rankOpportunities(ops, input.preferences, { now, staleAfterSeconds: 900, principalByAsset: { USDC: 500 }, usdPrices: { SOL: 100, USDC: 1 } });

const validExplanation = {
  summary: "Kamino USDC supply is the best match at an estimated 4.74% APY.",
  rationale: "It is the only eligible USDC option; a higher-yield option was excluded for high risk.",
  riskExplanation: "Smart-contract and stablecoin risk apply. Utilization is 90.0%.",
  uncertainty: "Confidence is medium because lending rates change with utilization.",
};
const client = (impl: LlmClient["explain"]): LlmClient => ({ explain: impl });

describe("deterministic decision engine", () => {
  it("recommends the best eligible option, not the highest APY", () => {
    const rec = buildDeterministicDecision(input, ranked());
    expect(rec.selectedStrategy?.opportunityId).toBe("kamino-usdc");
    expect(rec.recommendation.action).toBe("deposit");
    expect(rec.excluded.map((e) => e.opportunityId)).toContain("risky-usdc");
    expect(rec.explanation.rationale).toMatch(/higher-APY option\(s\) were excluded/);
    expect(decisionRecordSchema.safeParse(rec).success).toBe(true);
  });
  it("includes assumptions, risks, fees, freshness and a disclaimer", () => {
    const rec = buildDeterministicDecision(input, ranked());
    expect(rec.assumptions.length).toBeGreaterThan(1);
    expect(rec.fees).not.toBeNull();
    expect(rec.dataFreshness[0].status).toBe("fresh");
    expect(rec.disclaimer).toMatch(/not guaranteed/);
    expect(rec.expectedNetYield!.netYield).toBeGreaterThan(0);
  });
  it("holds when nothing is eligible", () => {
    const rec = buildDeterministicDecision({ ...input, preferences: { ...RISK_PROFILES.conservative } }, rankOpportunities(ops, RISK_PROFILES.conservative, { now, staleAfterSeconds: 900, principalByAsset: { USDC: 500 }, usdPrices: {} }));
    expect(rec.recommendation.action).toBe("hold");
    expect(rec.selectedStrategy).toBeNull();
    expect(rec.confidence.level).toBe("low");
  });
  it("asks for configuration when the best match is not executable", () => {
    const nonExec = [makeOpportunity({ id: "k", executable: false, executableReason: "mainnet only" }, now)];
    const rec = buildDeterministicDecision(input, rankOpportunities(nonExec, input.preferences, { now, staleAfterSeconds: 900, principalByAsset: { USDC: 500 }, usdPrices: {} }));
    expect(rec.recommendation.action).toBe("configure");
    expect(rec.suggestedNextAction).toBe("mainnet only");
  });
  it("holds when fees exceed yield", () => {
    const rec = buildDeterministicDecision({ ...input, asset: "SOL", amount: 0.0001, preferences: { ...input.preferences, horizonDays: 1 } }, rankOpportunities(ops, { ...input.preferences, horizonDays: 1 }, { now, staleAfterSeconds: 900, principalByAsset: { SOL: 0.0001 }, usdPrices: {} }));
    expect(rec.recommendation.action).toBe("hold");
    expect(rec.recommendation.headline).toMatch(/costs exceed/);
  });
  it("marks demo data as low confidence", () => {
    const demo = demoOpportunities(now);
    const rec = buildDeterministicDecision({ ...input, mode: "demo" }, rankOpportunities(demo, input.preferences, { now, staleAfterSeconds: 900, principalByAsset: { USDC: 500 }, usdPrices: {} }));
    expect(rec.confidence.level).toBe("low");
  });
});

describe("numeric guard", () => {
  it("extracts numbers including thousands separators", () => {
    expect(extractNumbers("APY 4.74% on 1,250.5 USDC over 90 days")).toEqual([4.74, 1250.5, 90]);
  });
  it("accepts numbers present in the facts and rejects invented ones", () => {
    expect(checkNumbers(["about 4.74%"], [4.741]).ok).toBe(true);
    const bad = checkNumbers(["you will earn 12.5% guaranteed"], [4.74]);
    expect(bad.ok).toBe(false);
    expect(bad.unexpected).toEqual([12.5]);
  });
  it("allows small integers used in prose", () => {
    expect(checkNumbers(["takes 2 transactions"], []).ok).toBe(true);
  });
});

describe("AI explanation validation", () => {
  it("accepts a valid, numerically grounded explanation", async () => {
    const rec = buildDeterministicDecision(input, ranked());
    const out = await explainWithLlm(rec, client(async () => ({ parsed: validExplanation, stopReason: "end_turn", model: "claude-opus-5-5" })), "claude-opus-5-5");
    expect(out.ok).toBe(true);
  });
  it("rejects output that fails the schema", () => {
    const rec = buildDeterministicDecision(input, ranked());
    expect(validateLlmOutput({ summary: "" }, rec, factsForLlm(rec)).ok).toBe(false);
    expect(validateLlmOutput(null, rec, factsForLlm(rec)).ok).toBe(false);
    expect(validateLlmOutput("free-form text", rec, factsForLlm(rec)).ok).toBe(false);
  });
  it("rejects output containing invented numbers", () => {
    const rec = buildDeterministicDecision(input, ranked());
    const out = validateLlmOutput({ ...validExplanation, summary: "Expect 18.2% returns over 365 days." }, rec, factsForLlm(rec));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/numbers not present/);
  });
  it("handles refusals, truncation and provider errors without throwing", async () => {
    const rec = buildDeterministicDecision(input, ranked());
    expect((await explainWithLlm(rec, client(async () => ({ parsed: null, stopReason: "refusal", model: "m" })), "m")).ok).toBe(false);
    expect((await explainWithLlm(rec, client(async () => ({ parsed: null, stopReason: "max_tokens", model: "m" })), "m")).ok).toBe(false);
    const failing = client(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    const out = await explainWithLlm(rec, failing, "m");
    expect(out).toEqual({ ok: false, reason: "AI provider timed out." });
    const garbage = await explainWithLlm(rec, client(async () => { throw new SyntaxError("Unexpected token"); }), "m");
    expect(garbage.ok).toBe(false);
  });
  it("never sends the wallet address to the model", () => {
    const rec = buildDeterministicDecision({ ...input, wallet: "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, ranked());
    expect(JSON.stringify(factsForLlm(rec))).not.toContain("EZC9");
  });
});

describe("recommend()", () => {
  it("works without an AI key and explains why", async () => {
    const rec = await recommend(input, ranked(), { llm: null });
    expect(rec.engine).toBe("deterministic");
    expect(rec.explanation.llmFallbackReason).toMatch(/no ANTHROPIC_API_KEY/);
  });
  it("uses AI prose but keeps deterministic numbers", async () => {
    const det = buildDeterministicDecision(input, ranked());
    const rec = await recommend(input, ranked(), { llm: { client: client(async () => ({ parsed: validExplanation, stopReason: "end_turn", model: "claude-opus-5-5" })), model: "claude-opus-5-5" } });
    expect(rec.engine).toBe("ai-assisted");
    expect(rec.explanation.generatedBy).toBe("llm");
    expect(rec.expectedNetYield).toEqual(det.expectedNetYield);
    expect(rec.selectedStrategy).toEqual(det.selectedStrategy);
  });
  it("falls back to the template when AI output is invalid", async () => {
    const rec = await recommend(input, ranked(), { llm: { client: client(async () => ({ parsed: { summary: 42 }, stopReason: "end_turn", model: "m" })), model: "m" } });
    expect(rec.engine).toBe("deterministic");
    expect(rec.explanation.generatedBy).toBe("template");
    expect(rec.explanation.llmFallbackReason).toMatch(/schema/);
  });
  it("never calls the AI for demo data", async () => {
    const explain = vi.fn();
    await recommend({ ...input, mode: "demo" }, rankOpportunities(demoOpportunities(now), input.preferences, { now, staleAfterSeconds: 900, principalByAsset: {}, usdPrices: {} }), { llm: { client: { explain }, model: "m" } });
    expect(explain).not.toHaveBeenCalled();
  });
});
