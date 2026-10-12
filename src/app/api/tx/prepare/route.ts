import { z } from "zod";
import { enforceRateLimit, handle, parseJsonBody } from "@/lib/http/api";
import { walletSchema } from "@/lib/http/schemas";
import { prepareTransaction } from "@/lib/tx/service";

const body = z.object({
  wallet: walletSchema,
  opportunityId: z.string().min(1).max(120).regex(/^[A-Za-z0-9-]+$/),
  amount: z.number().finite().positive().max(1e9),
  reviewedApy: z.number().finite().min(0),
});

export const POST = handle("tx.prepare", async (req) => {
  enforceRateLimit(req, "tx.prepare", 10);
  const input = await parseJsonBody(req, body);
  return Response.json(await prepareTransaction(input));
});
