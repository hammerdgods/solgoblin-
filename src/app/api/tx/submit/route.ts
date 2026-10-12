import { z } from "zod";
import { enforceRateLimit, handle, parseJsonBody } from "@/lib/http/api";
import { submitSignedTransaction } from "@/lib/tx/service";

const body = z.object({ intentId: z.uuid(), signedTransaction: z.string().min(1).max(4000) });

export const POST = handle("tx.submit", async (req) => {
  enforceRateLimit(req, "tx.submit", 10);
  const input = await parseJsonBody(req, body);
  return Response.json(await submitSignedTransaction(input.intentId, input.signedTransaction));
});
