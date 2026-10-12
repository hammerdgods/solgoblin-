import { randomUUID } from "node:crypto";
import { z } from "zod";
import { anthropicClient } from "@/lib/agent/llm";
import { recommend } from "@/lib/agent/recommend";
import { getServerConfig } from "@/lib/config/server";
import { enforceRateLimit, handle, parseJsonBody } from "@/lib/http/api";
import { amountSchema, assetSchema, modeSchema, preferencesSchema, walletSchema } from "@/lib/http/schemas";
import { log } from "@/lib/log";
import { getUsdPrices, usdMap } from "@/lib/prices";
import { rankOpportunities } from "@/lib/scanner/rank";
import { getStore, requireNetwork, scanOpportunities } from "@/lib/server/services";

const body = z.object({
  mode: modeSchema,
  asset: assetSchema,
  amount: amountSchema,
  wallet: walletSchema.nullable().default(null),
  preferences: preferencesSchema,
});

export const POST = handle("agent.recommend", async (req) => {
  // AI calls cost money: keep this tighter than read endpoints.
  enforceRateLimit(req, "agent.recommend", 12);
  const input = await parseJsonBody(req, body);
  const cfg = getServerConfig();
  const network = requireNetwork();
  const [scan, prices] = await Promise.all([scanOpportunities(input.mode), getUsdPrices()]);
  const now = new Date();
  const ranked = rankOpportunities(scan.opportunities, input.preferences, {
    now,
    staleAfterSeconds: cfg.monitoring.staleAfterSeconds,
    principalByAsset: { [input.asset]: input.amount },
    usdPrices: usdMap(prices.prices),
  });
  const record = await recommend(
    { id: randomUUID(), asset: input.asset, amount: input.amount, wallet: input.wallet, preferences: input.preferences, mode: input.mode, network, now, staleAfterSeconds: cfg.monitoring.staleAfterSeconds, prices: input.mode === "live" ? prices.prices : {} },
    ranked,
    { llm: cfg.ai.apiKey ? { client: anthropicClient(cfg.ai.apiKey), model: cfg.ai.model } : null },
  );
  try {
    const store = await getStore();
    await store.insertRecommendation({ id: record.id, wallet: input.wallet, mode: record.mode, engine: record.engine, record, created_at: record.createdAt });
  } catch (e) {
    log.warn("agent.recommend", "could not persist decision record", { message: (e as Error).message });
  }
  return Response.json({ record, scanErrors: scan.errors });
});
