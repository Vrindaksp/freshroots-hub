import { query, queryOne } from "./db";
import { deriveKillSwitchState, isHardStop, type AutomationEvent, type KillSwitchState } from "./killswitch-state";

export type { AutomationEvent, KillSwitchState } from "./killswitch-state";

/** Thrown by guarded operations while automation is paused. Callers surface `message` to the user. */
export class AutomationPausedError extends Error {
  constructor(
    public readonly what: string,
    public readonly state: KillSwitchState,
  ) {
    super(
      state.source === "environment"
        ? `Automation is hard-stopped by server configuration, so ${what} is blocked. Remove KILL_SWITCH in Vercel and redeploy to resume.`
        : `Automation is paused${state.reason ? ` (${state.reason})` : ""}, so ${what} is blocked. Resume it from the Kill switch menu.`,
    );
    this.name = "AutomationPausedError";
  }
}

const EVENT_SELECT = `select id::int as id, action, reason, actor,
       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt"
     from automation_events`;

/** A database that has not been migrated yet has no table; that must read as "running", not crash every page. */
function isMissingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /automation_events/.test(message) && /does not exist|no such table/i.test(message);
}

export async function getKillSwitch(): Promise<KillSwitchState> {
  const hardStop = isHardStop(process.env.KILL_SWITCH);
  let latest: AutomationEvent | undefined;
  try {
    latest = await queryOne<AutomationEvent>(`${EVENT_SELECT} order by id desc limit 1`);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return deriveKillSwitchState(hardStop, latest ?? null);
}

/** Call at the top of anything that runs the engine, calls Gemini or signs off a PO. */
export async function assertAutomationRunning(what: string): Promise<void> {
  const state = await getKillSwitch();
  if (state.paused) throw new AutomationPausedError(what, state);
}

export async function getRecentAutomationEvents(limit = 8): Promise<AutomationEvent[]> {
  try {
    return await query<AutomationEvent>(`${EVENT_SELECT} order by id desc limit $1`, [limit]);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function setAutomationPaused(paused: boolean, reason: string, actor: string): Promise<KillSwitchState> {
  const current = await getKillSwitch();
  if (!paused && current.source === "environment") {
    throw new Error("The hard stop is set in server configuration (KILL_SWITCH). Remove it in Vercel and redeploy to resume.");
  }
  if (paused === current.paused) return current; // already in that state: do not log a duplicate event

  const clean = reason.trim();
  if (paused && clean.length < 5) throw new Error("Give a reason (at least 5 characters) so the next person knows why automation stopped.");

  await query("insert into automation_events (action, reason, actor) values ($1, $2, $3)", [
    paused ? "pause" : "resume",
    clean || "Resumed",
    actor,
  ]);
  return getKillSwitch();
}
