import { z } from "zod";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { getTransactionStatus } from "@/lib/tx/service";

export const GET = handle("tx.status", async (req) => {
  enforceRateLimit(req, "tx.status", 120);
  const q = z.object({ id: z.uuid() }).safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) throw new ApiError(400, "INVALID_INPUT", "A valid intent id is required.");
  return Response.json(await getTransactionStatus(q.data.id));
});
