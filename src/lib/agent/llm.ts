import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { numericFacts } from "./deterministic";
import { allowedForms, checkNumbers, extractNumbers } from "./numericGuard";
import { llmExplanationSchema, type DecisionRecord, type LlmExplanation } from "./schema";

/**
 * Optional AI explanation layer (server-side only).
 * The model receives the finished deterministic decision record and may only
 * rephrase/explain it. Its output is schema-validated and numerically guarded;
 * on any failure the deterministic template explanation is kept.
 */

const SYSTEM_PROMPT = `You are SolGoblin's explanation writer for a Solana yield analytics app.
You receive a FACTS JSON object produced by deterministic code. Write a short, plain-language explanation for a retail user.

Rules:
- Explain the recommendation that is already in FACTS. Do not pick a different strategy and do not suggest other protocols, tokens, or actions not present in FACTS.
- Only use numbers that appear in FACTS, written the same way (percentages as shown). Do not compute new numbers, projections, or USD amounts.
- Never promise or imply guaranteed returns. Call rates "estimated" or "variable". Price changes are not yield.
- Mention the most important risks and the confidence level with its reasons.
- Be concise, neutral, and specific. No hype, no emojis.`;

export type LlmOutcome = { ok: true; explanation: LlmExplanation; model: string } | { ok: false; reason: string };

export interface LlmClient {
  explain(facts: unknown, model: string): Promise<{ parsed: unknown; stopReason: string | null; model: string }>;
}

/** Default client using the official Anthropic SDK with structured outputs. */
export function anthropicClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    async explain(facts, model) {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        // Opus-tier: thinking is adaptive by default; keep effort low for a short explanation task.
        output_config: { effort: "low", format: zodOutputFormat(llmExplanationSchema) },
        // Server-side refusal fallback (routes declined requests to a fallback model by category).
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts)}` }],
      });
      return { parsed: res.parsed_output, stopReason: res.stop_reason, model: res.model };
    },
  };
}

/** The subset of the record sent to the model. No wallet address is sent. */
export function factsForLlm(record: DecisionRecord) {
  return {
    asset: record.input.asset,
    amount: record.input.amount,
    horizonDays: record.input.preferences.horizonDays,
    riskTolerance: record.input.preferences.maxRiskLevel,
    dataMode: record.mode,
    network: record.network,
    recommendation: record.recommendation,
    selectedStrategy: record.selectedStrategy && { protocol: record.selectedStrategy.protocol, name: record.selectedStrategy.strategyName, rateType: record.selectedStrategy.rateType },
    supportingData: record.supportingData.map((s) => ({ label: s.label, value: s.value })),
    deterministicSummary: record.explanation.summary,
    deterministicRationale: record.explanation.rationale,
    assumptions: record.assumptions,
    risks: record.risks.map((r) => ({ title: r.title, level: r.level, detail: r.detail })),
    confidence: record.confidence,
    alternatives: record.alternatives.map((a) => ({ name: a.strategyName, reason: a.reason })),
    excluded: record.excluded.map((e) => ({ name: e.strategyName, reasons: e.reasons })),
    suggestedNextAction: record.suggestedNextAction,
  };
}

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

/** Validate untrusted model output: schema first, then the numeric guard. */
export function validateLlmOutput(parsed: unknown, record: DecisionRecord, facts: unknown): LlmOutcome | { ok: true; explanation: LlmExplanation } {
  const result = llmExplanationSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "AI response did not match the required schema." };
  const allowed = allowedForms([...numericFacts(record), ...collectStrings(facts).flatMap(extractNumbers)]);
  const e = result.data;
  const guard = checkNumbers([e.summary, e.rationale, e.riskExplanation, e.uncertainty], allowed);
  if (!guard.ok) return { ok: false, reason: `AI response contained numbers not present in the source data (${guard.unexpected.slice(0, 5).join(", ")}).` };
  return { ok: true, explanation: e };
}

export async function explainWithLlm(record: DecisionRecord, client: LlmClient, model: string): Promise<LlmOutcome> {
  const facts = factsForLlm(record);
  let res: Awaited<ReturnType<LlmClient["explain"]>>;
  try {
    res = await client.explain(facts, model);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, reason: "AI provider rejected the API key." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "AI provider rate limit reached." };
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: "AI provider timed out." };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: `AI provider error (${err.status ?? "network"}).` };
    return { ok: false, reason: "AI response could not be parsed." };
  }
  if (res.stopReason === "refusal") return { ok: false, reason: "AI model declined to answer." };
  if (res.stopReason === "max_tokens") return { ok: false, reason: "AI response was truncated." };
  const v = validateLlmOutput(res.parsed, record, facts);
  return v.ok ? { ok: true, explanation: v.explanation, model: res.model } : v;
}
