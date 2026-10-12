import type { RankedOpportunity } from "../scanner/rank";
import { buildDeterministicDecision, type DecisionInput } from "./deterministic";
import { explainWithLlm, type LlmClient } from "./llm";
import { decisionRecordSchema, type DecisionRecord } from "./schema";

export interface RecommendDeps {
  llm: { client: LlmClient; model: string } | null;
}

/**
 * Produce a validated decision record. The deterministic engine always runs;
 * the AI layer (if configured) can only replace the explanation prose.
 */
export async function recommend(input: DecisionInput, ranked: RankedOpportunity[], deps: RecommendDeps): Promise<DecisionRecord> {
  const record = buildDeterministicDecision(input, ranked);

  if (!deps.llm) {
    record.explanation.llmFallbackReason = "AI assistance is unavailable (no ANTHROPIC_API_KEY configured). Showing the deterministic explanation.";
  } else if (input.mode === "demo") {
    record.explanation.llmFallbackReason = "AI assistance is not used for demo data.";
  } else {
    const out = await explainWithLlm(record, deps.llm.client, deps.llm.model);
    if (out.ok) {
      record.engine = "ai-assisted";
      record.model = out.model;
      record.explanation = { generatedBy: "llm", ...out.explanation, llmFallbackReason: null };
    } else {
      record.explanation.llmFallbackReason = `${out.reason} Showing the deterministic explanation.`;
    }
  }
  // Final self-check: the record we return must satisfy its own schema.
  return decisionRecordSchema.parse(record);
}
