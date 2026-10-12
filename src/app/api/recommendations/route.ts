import { z } from "zod";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { getStore } from "@/lib/server/services";

export const GET = handle("recommendations", async (req) => {
  enforceRateLimit(req, "recommendations", 60);
  const q = z.object({ wallet: walletSchema }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ApiError(400, "INVALID_INPUT", "A valid wallet is required.");
  const store = await getStore();
  return Response.json({ records: await store.listRecommendations({ wallet: q.data.wallet, limit: 20 }) });
});
