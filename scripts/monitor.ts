/**
 * Local monitoring loop for single-server deployments.
 * Calls the running app's GET /api/monitor/run with CRON_SECRET every
 * MONITOR_INTERVAL_SECONDS. Failures are logged and retried next tick; this
 * script never builds or sends transactions.
 *
 *   APP_URL=http://localhost:3000 CRON_SECRET=... npm run monitor
 */

const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
const intervalSeconds = Math.max(30, Number(process.env.MONITOR_INTERVAL_SECONDS ?? 300) || 300);

if (!secret) {
  console.error("CRON_SECRET is required (it must match the server's CRON_SECRET).");
  process.exit(1);
}

async function tick(): Promise<void> {
  const started = new Date().toISOString();
  try {
    const res = await fetch(`${appUrl}/api/monitor/run`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000) });
    const body = await res.text();
    if (!res.ok) console.error(`[${started}] monitor run failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    else console.log(`[${started}] ${body}`);
  } catch (e) {
    console.error(`[${started}] monitor run error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`Monitoring ${appUrl} every ${intervalSeconds}s`);
void tick();
setInterval(() => void tick(), intervalSeconds * 1000);
