import { runAlertChecks } from "./alerts/run";
import { generateOpsBrief } from "./ai/brief";
import { generateEdgeCommentary } from "./ai/commentary";
import { query } from "./db";
import { assertAutomationRunning } from "./killswitch";
import { runEngine, type EngineRunResult } from "./engine/run";
import { refreshStateMetrics, refreshWeeklyMetrics } from "./metrics/snapshot";

export interface RefreshSummary {
  run: EngineRunResult;
  metricsWritten: number;
  alerts: { active: number; resolved: number };
  commentaryGenerated: number;
  briefGenerated: boolean;
}

/**
 * The end-to-end refresh used by the "Run planning engine" button and the scheduled job:
 * rules → draft POs → metrics → anomaly checks → Gemini commentary → executive brief.
 */
export async function refreshIntelligence(
  opts: { commentary?: boolean; brief?: boolean; /** Maintenance scripts only (db:setup). */ ignoreKillSwitch?: boolean } = {},
): Promise<RefreshSummary> {
  if (!opts.ignoreKillSwitch) await assertAutomationRunning("the planning engine");
  const run = await runEngine();
  const metricsWritten = await refreshWeeklyMetrics(run.asOf);
  await refreshStateMetrics(run.asOf);
  const alerts = await runAlertChecks(run.asOf);

  const commentaryGenerated = opts.commentary === false ? 0 : await generateEdgeCommentary(run.runId);
  const brief = opts.brief === false ? undefined : await generateOpsBrief();

  // Keep the last 30 runs; signals and AI output cascade, purchase orders keep their history.
  await query("delete from engine_runs where id <= (select max(id) - 30 from engine_runs)");

  return { run, metricsWritten, alerts, commentaryGenerated, briefGenerated: Boolean(brief) };
}
