import { z } from "zod";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { getPortfolio } from "@/lib/server/portfolio";

export const GET = handle("portfolio", async (req) => {
  enforceRateLimit(req, "portfolio", 30);
  const q = z.object({ wallet: walletSchema }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ApiError(400, "INVALID_INPUT", "A valid wallet is required.");
  return Response.json(await getPortfolio(q.data.wallet));
});
