import { hasValidBearer } from "@/lib/auth";
import { refreshIntelligence } from "@/lib/intelligence";

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
