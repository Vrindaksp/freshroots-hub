/**
 * Kill-switch state rules. Pure and client-safe (no database, no server imports) so the UI can share the
 * types and the logic can be unit-tested.
 *
 * Two layers:
 *   1. Hard stop  — the KILL_SWITCH environment variable (server configuration). Always wins and cannot be
 *                   undone from inside the app; remove it in Vercel and redeploy to resume.
 *   2. Soft pause — the latest row in automation_events. Flipped from the UI, instant, no redeploy.
 */

export interface AutomationEvent {
  id: number;
  action: "pause" | "resume";
  reason: string;
  actor: string;
  createdAt: string;
}

export interface KillSwitchState {
  paused: boolean;
  /** Which layer is stopping things: the environment variable, a UI pause, or neither. */
  source: "environment" | "database" | "none";
  reason: string | null;
  actor: string | null;
  since: string | null;
}

export function isHardStop(value: string | undefined): boolean {
  return ["1", "true", "on", "paused", "yes"].includes((value ?? "").trim().toLowerCase());
}

export function deriveKillSwitchState(hardStop: boolean, latest: AutomationEvent | null): KillSwitchState {
  if (hardStop) {
    return {
      paused: true,
      source: "environment",
      reason: "Hard stop set in server configuration (KILL_SWITCH).",
      actor: "server configuration",
      since: null,
    };
  }
  if (latest?.action === "pause") {
    return { paused: true, source: "database", reason: latest.reason, actor: latest.actor, since: latest.createdAt };
  }
  return { paused: false, source: "none", reason: null, actor: null, since: latest?.createdAt ?? null };
}

/** What a pause stops and what keeps working — shown in the panel and read out by the walkthrough. */
export const KILL_SWITCH_STOPS = [
  "Planning engine runs (the button, the daily refresh, and ingest with refresh)",
  "Every Gemini call: edge-case commentary, executive brief, note parsing",
  "Zoho pushes: purchase orders and items sent to Zoho",
  "Purchase-order sign-off: approve, override, reject and bulk approve",
];

export const KILL_SWITCH_KEEPS = [
  "Viewing every dashboard and the purchase-order export",
  "Data ingestion: sales, stock and metrics are still stored",
  "Acknowledging alerts and saving planner notes (parsed by rules, not Gemini)",
];
