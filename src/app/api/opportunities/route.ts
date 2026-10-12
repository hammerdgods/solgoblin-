import { z } from "zod";
import { getServerConfig } from "@/lib/config/server";
import { enforceRateLimit, handle, ApiError } from "@/lib/http/api";
import { modeSchema, riskLevelSchema } from "@/lib/http/schemas";
import { getUsdPrices, usdMap } from "@/lib/prices";
import { rankOpportunities } from "@/lib/scanner/rank";
import { scanOpportunities } from "@/lib/server/services";

const query = z.object({
  mode: modeSchema,
  maxRisk: riskLevelSchema.default("medium"),
  maxDelayHours: z.coerce.number().min(0).max(1440).default(96),
  horizonDays: z.coerce.number().int().min(1).max(3650).default(90),
  sol: z.coerce.number().min(0).max(1e9).default(0),
  usdc: z.coerce.number().min(0).max(1e12).default(0),
});

export const GET = handle("opportunities", async (req) => {
  enforceRateLimit(req, "opportunities", 60);
  const params = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!params.success) throw new ApiError(400, "INVALID_INPUT", "Invalid query parameters.");
  const q = params.data;
  const cfg = getServerConfig();
  const [scan, prices] = await Promise.all([scanOpportunities(q.mode), getUsdPrices()]);
  const ranked = rankOpportunities(
    scan.opportunities,
    { maxRiskLevel: q.maxRisk, maxWithdrawalDelayHours: q.maxDelayHours, allowedAssets: ["SOL", "USDC"], horizonDays: q.horizonDays },
    { now: new Date(), staleAfterSeconds: cfg.monitoring.staleAfterSeconds, principalByAsset: { SOL: q.sol, USDC: q.usdc }, usdPrices: usdMap(prices.prices) },
  );
  return Response.json({ scan: { mode: scan.mode, network: scan.network, scannedAt: scan.scannedAt, errors: scan.errors }, ranked, prices: { quotes: prices.prices, warnings: prices.warnings }, staleAfterSeconds: cfg.monitoring.staleAfterSeconds });
});
