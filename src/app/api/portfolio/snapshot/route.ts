import { z } from "zod";
import { enforceRateLimit, handle, parseJsonBody } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { recordPortfolioSnapshot } from "@/lib/server/portfolio";

/** Records a snapshot using values the server reads from chain; the client only names the wallet. */
export const POST = handle("portfolio.snapshot", async (req) => {
  enforceRateLimit(req, "portfolio.snapshot", 10);
  const { wallet } = await parseJsonBody(req, z.object({ wallet: walletSchema }));
  const result = await recordPortfolioSnapshot(wallet);
  return Response.json("skipped" in result ? { recorded: false, reason: result.skipped } : { recorded: true, id: result.id });
});
