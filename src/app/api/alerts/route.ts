import { z } from "zod";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { getStore } from "@/lib/server/services";

export const GET = handle("alerts", async (req) => {
  enforceRateLimit(req, "alerts", 60);
  const q = z.object({ wallet: walletSchema.optional() }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ApiError(400, "INVALID_INPUT", "Invalid wallet.");
  const store = await getStore();
  return Response.json({ alerts: await store.listAlerts({ wallet: q.data.wallet, limit: 50 }), persistence: { kind: store.kind, durable: store.durable } });
});
