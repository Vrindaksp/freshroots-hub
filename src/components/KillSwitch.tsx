import { connection } from "next/server";
import { getKillSwitch, getRecentAutomationEvents } from "@/lib/killswitch";
import { KillSwitchDialog, OpenKillSwitchButton } from "./KillSwitchDialog";

/** Header control: current state + the dialog to flip it. Read fresh on every request. */
export async function KillSwitchControl() {
  await connection();
  const [state, events] = await Promise.all([getKillSwitch(), getRecentAutomationEvents(8)]);
  return <KillSwitchDialog state={state} events={events} />;
}

/** Site-wide banner so nobody wonders why the engine is not responding. Renders nothing while automation runs. */
export async function KillSwitchBanner() {
  await connection();
  const state = await getKillSwitch();
  if (!state.paused) return null;

  const since = state.since ? new Date(state.since) : null;
  const when = since
    ? ` · since ${since.getUTCDate()} ${since.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}, ${String(since.getUTCHours()).padStart(2, "0")}:${String(since.getUTCMinutes()).padStart(2, "0")} UTC`
    : "";

  return (
    <div role="alert" className="border-b border-crit/30 bg-crit-soft text-crit">
      <div className="mx-auto flex w-full max-w-[1480px] items-center gap-3 px-4 py-2 text-[13px] sm:px-6">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="shrink-0">
          <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
          <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
        </svg>
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Automation paused</strong>
          <span className="text-ink"> — {state.reason}{when}{state.actor && state.source === "database" ? ` · by ${state.actor}` : ""}. </span>
          <span className="text-ink-2">The engine, Gemini and PO sign-off are stopped; dashboards stay readable.</span>
        </p>
        <OpenKillSwitchButton />
      </div>
    </div>
  );
}
