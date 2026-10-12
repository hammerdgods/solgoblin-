import { z } from "zod";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { getEarnings } from "@/lib/server/earnings";

export const GET = handle("earnings", async (req) => {
  enforceRateLimit(req, "earnings", 20);
  const q = z.object({ wallet: walletSchema }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ApiError(400, "INVALID_INPUT", "A valid wallet is required.");
  return Response.json(await getEarnings(q.data.wallet));
});
