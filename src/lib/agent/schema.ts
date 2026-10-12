import { z } from "zod";

/**
 * Auditable decision record. Every numeric field here is produced by deterministic
 * code from sourced data; the optional AI layer may only add explanatory prose.
 */

const riskSchema = z.object({ id: z.string(), level: z.enum(["low", "medium", "high"]), title: z.string(), detail: z.string() });

export const decisionRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  mode: z.enum(["live", "demo"]),
  network: z.string(),
  engine: z.enum(["deterministic", "ai-assisted"]),
  model: z.string().nullable(),
  input: z.object({
    asset: z.enum(["SOL", "USDC"]),
    amount: z.number().nonnegative(),
    wallet: z.string().nullable(),
    preferences: z.object({
      maxRiskLevel: z.enum(["low", "medium", "high"]),
      maxWithdrawalDelayHours: z.number(),
      allowedAssets: z.array(z.enum(["SOL", "USDC"])),
      horizonDays: z.number(),
    }),
  }),
  recommendation: z.object({
    action: z.enum(["deposit", "hold", "configure", "review-position"]),
    headline: z.string(),
  }),
  selectedStrategy: z
    .object({
      opportunityId: z.string(),
      protocol: z.string(),
      strategyName: z.string(),
      rateType: z.string(),
      apy: z.number(),
      executable: z.boolean(),
      score: z.number(),
    })
    .nullable(),
  supportingData: z.array(z.object({ label: z.string(), value: z.string(), source: z.string(), fetchedAt: z.string().nullable() })),
  expectedNetYield: z
    .object({
      asset: z.string(),
      principal: z.number(),
      horizonDays: z.number(),
      grossYield: z.number(),
      protocolFee: z.number(),
      networkFees: z.number(),
      netYield: z.number(),
      effectiveAnnualRate: z.number().nullable(),
      breakEvenDays: z.number().nullable(),
      feesIncluded: z.boolean(),
    })
    .nullable(),
  assumptions: z.array(z.string()),
  risks: z.array(riskSchema),
  fees: z.object({
    entryNetworkFeeLamports: z.number(),
    exitNetworkFeeLamports: z.number(),
    refundableRentLamports: z.number(),
    protocolFeeRate: z.number(),
    notes: z.array(z.string()),
  }).nullable(),
  dataFreshness: z.array(z.object({ source: z.string(), fetchedAt: z.string(), ageSeconds: z.number().nullable(), status: z.enum(["fresh", "stale", "unknown"]) })),
  confidence: z.object({ level: z.enum(["low", "medium", "high"]), explanation: z.string() }),
  alternatives: z.array(z.object({ opportunityId: z.string(), strategyName: z.string(), apy: z.number(), score: z.number(), reason: z.string() })),
  excluded: z.array(z.object({ opportunityId: z.string(), strategyName: z.string(), reasons: z.array(z.string()) })),
  suggestedNextAction: z.string(),
  explanation: z.object({
    generatedBy: z.enum(["template", "llm"]),
    summary: z.string(),
    rationale: z.string(),
    riskExplanation: z.string(),
    uncertainty: z.string(),
    /** Why the LLM output was not used, if it wasn't. */
    llmFallbackReason: z.string().nullable(),
  }),
  disclaimer: z.string(),
});

export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

/**
 * The ONLY thing the LLM may return. No numbers are taken from it; prose is
 * checked by the numeric guard before being shown.
 */
export const llmExplanationSchema = z.object({
  summary: z.string().min(1).max(600),
  rationale: z.string().min(1).max(1500),
  riskExplanation: z.string().min(1).max(1200),
  uncertainty: z.string().min(1).max(800),
});

export type LlmExplanation = z.infer<typeof llmExplanationSchema>;

export const DISCLAIMER =
  "Estimates only. APYs are variable and not guaranteed; past or current rates do not predict future returns. You can lose money through smart-contract failures, stablecoin depegs, validator issues, or price changes. This is not financial advice.";
