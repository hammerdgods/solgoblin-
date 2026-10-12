import { timingSafeEqual } from "node:crypto";
import { getServerConfig } from "@/lib/config/server";
import { ApiError, enforceRateLimit, handle } from "@/lib/http/api";
import { runMonitor } from "@/lib/monitor/run";

function authorized(req: Request): boolean {
  const secret = getServerConfig().monitoring.cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Scheduled entry point (e.g. Vercel Cron sends GET with "Authorization: Bearer $CRON_SECRET"). */
export const GET = handle("monitor.run", async (req) => {
  if (!authorized(req)) throw new ApiError(401, "UNAUTHORIZED", "Monitoring runs require CRON_SECRET authorization.");
  return Response.json(await runMonitor());
});

/** Manual "check now" from the UI: unauthenticated but heavily rate limited; it never executes transactions. */
export const POST = handle("monitor.run.manual", async (req) => {
  enforceRateLimit(req, "monitor.run.manual", 2, 5 * 60_000);
  return Response.json(await runMonitor());
});
