import { hasValidBearer } from "@/lib/auth";
import { refreshIntelligence } from "@/lib/intelligence";
import { getKillSwitch } from "@/lib/killswitch";

export const maxDuration = 120;

/**
 * Scheduled refresh (see vercel.json): rules → draft POs → metrics → anomaly checks → Gemini.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once CRON_SECRET is set.
 * Outside production the secret is optional so the job can be tried by hand.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const open = process.env.NODE_ENV !== "production" && !secret;
  if (!open && !hasValidBearer(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Kill switch: report a clean "skipped" (HTTP 200) so Vercel does not flag the scheduled run as failed.
  const killSwitch = await getKillSwitch();
  if (killSwitch.paused) {
    return Response.json({ skipped: true, paused: true, source: killSwitch.source, reason: killSwitch.reason, since: killSwitch.since });
  }
  const { run, metricsWritten, alerts, commentaryGenerated, briefGenerated } = await refreshIntelligence();
  return Response.json({
    runId: run.runId,
    asOf: run.asOf,
    reorder: run.reorder,
    pause: run.pause,
    draftPos: run.draftPos,
    edgeCases: run.edgeCases,
    metricsWritten,
    alerts,
    commentaryGenerated,
    briefGenerated,
  });
}
