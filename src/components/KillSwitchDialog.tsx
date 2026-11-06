"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { setAutomation } from "@/app/actions";
import { KILL_SWITCH_KEEPS, KILL_SWITCH_STOPS, type AutomationEvent, type KillSwitchState } from "@/lib/killswitch-state";
import { onKillSwitchOpen, setKillSwitchOpen, startTour } from "./events";
import { btnBase, btnSecondary } from "./ui";

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function Dot({ paused }: { paused: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${paused ? "bg-red-400" : "bg-emerald-400"}`} aria-hidden />;
}

/** Banner button: opens the dialog from anywhere. */
export function OpenKillSwitchButton() {
  return (
    <button type="button" onClick={() => setKillSwitchOpen(true)} className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10">
      Open kill switch
    </button>
  );
}

export function KillSwitchDialog({ state, events }: { state: KillSwitchState; events: AutomationEvent[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmResume, setConfirmResume] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => onKillSwitchOpen(setOpen), []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function flip(paused: boolean) {
    start(async () => {
      const r = await setAutomation({ paused, reason });
      setResult({ ok: r.ok, text: r.ok ? r.message : r.error });
      if (r.ok) {
        setReason("");
        setConfirmResume(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        data-tour="killswitch"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-md border border-white/15 px-2.5 py-1.5 text-[13px] font-medium text-slate-100 transition hover:bg-white/10"
      >
        <Dot paused={state.paused} />
        <span className="hidden sm:inline">Kill switch</span>
        <span className={state.paused ? "font-semibold text-red-300" : "text-slate-400"}>{state.paused ? "Paused" : <span className="hidden sm:inline">Live</span>}</span>
        {!state.paused && <span className="sr-only sm:hidden">Kill switch: live</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ks-title" data-tour="ks-panel" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 id="ks-title" className="text-[16px] font-semibold text-ink">
                  Kill switch
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-3">One control that stops all automation. Dashboards stay readable.</p>
              </div>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close kill switch" className={`${btnBase} !px-2 text-ink-2 hover:bg-surface-2`}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <section data-tour="ks-status" className={`rounded-xl border px-4 py-3 ${state.paused ? "border-crit/30 bg-crit-soft" : "border-ok/25 bg-ok-soft"}`} aria-live="polite">
                <p className={`flex items-center gap-2 text-[15px] font-semibold ${state.paused ? "text-crit" : "text-ok"}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${state.paused ? "bg-crit" : "bg-ok"}`} aria-hidden />
                  {state.paused ? "Automation is PAUSED" : "Automation is running"}
                </p>
                {state.paused ? (
                  <p className="mt-1 text-[13px] text-ink-2">
                    {state.reason}
                    {state.since && <span className="text-ink-3"> · since {stamp(state.since)}</span>}
                    {state.actor && state.source === "database" && <span className="text-ink-3"> · by {state.actor}</span>}
                    <span className="block text-xs text-ink-3">{state.source === "environment" ? "Source: server hard stop. It cannot be resumed from this screen." : "Source: paused from this screen."}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-2">The engine, the daily refresh, Gemini and purchase-order sign-off are all active.</p>
                )}
              </section>

              <section data-tour="ks-scope" className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line p-3">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-crit">Pausing stops</h3>
                  <ul className="space-y-1.5 text-[13px] text-ink-2">
                    {KILL_SWITCH_STOPS.map((s) => (
                      <li key={s} className="flex gap-2">
                        <span className="mt-0.5 text-crit" aria-hidden>✕</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ok">Keeps working</h3>
                  <ul className="space-y-1.5 text-[13px] text-ink-2">
                    {KILL_SWITCH_KEEPS.map((s) => (
                      <li key={s} className="flex gap-2">
                        <span className="mt-0.5 text-ok" aria-hidden>✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section data-tour="ks-action" className="rounded-xl border border-line p-4">
                {state.paused ? (
                  state.source === "environment" ? (
                    <p className="text-[13px] text-ink-2">
                      The hard stop is set by the <code className="rounded bg-surface-2 px-1">KILL_SWITCH</code> environment variable. To resume, remove it in Vercel → Settings → Environment Variables and redeploy.
                    </p>
                  ) : confirmResume ? (
                    <div className="space-y-2">
                      <p className="text-[13px] text-ink">Resume everything? Engine runs, Gemini and PO sign-off start working immediately for all users.</p>
                      <div className="flex gap-2">
                        <button type="button" disabled={pending} onClick={() => flip(false)} className={`${btnBase} bg-ok text-white hover:brightness-110 dark:text-slate-900`}>
                          {pending ? "Resuming…" : "Yes, resume automation"}
                        </button>
                        <button type="button" onClick={() => setConfirmResume(false)} className={btnSecondary}>
                          Keep paused
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[13px] text-ink-2">Check the cause is fixed, then resume. The log below records who resumed and when.</p>
                      <button type="button" onClick={() => setConfirmResume(true)} className={`${btnBase} border border-ok text-ok hover:bg-ok-soft`}>
                        Resume automation…
                      </button>
                    </div>
                  )
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      flip(true);
                    }}
                    className="space-y-2"
                  >
                    <label htmlFor="ks-reason" className="text-[13px] font-medium text-ink">
                      Why are you pausing? <span className="font-normal text-ink-3">(shown to everyone and kept in the log)</span>
                    </label>
                    <textarea
                      id="ks-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      maxLength={300}
                      placeholder="e.g. Stock snapshot looks wrong — hold all orders until it is checked"
                      className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
                    />
                    <button type="submit" disabled={pending || reason.trim().length < 5} className={`${btnBase} bg-crit text-white hover:brightness-110 dark:text-slate-900`}>
                      {pending ? "Pausing…" : "Pause all automation"}
                    </button>
                  </form>
                )}
                {result && <p className={`mt-2 text-xs ${result.ok ? "text-ok" : "text-crit"}`} role="status">{result.text}</p>}
              </section>

              <section data-tour="ks-hard" className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Hard stop (server level)</h3>
                <p className="mt-1">
                  For emergencies, set <code className="rounded bg-surface px-1">KILL_SWITCH=1</code> in Vercel → Settings → Environment Variables and redeploy. It overrides this screen and cannot be switched off from the app. Remove it and redeploy to resume.
                </p>
              </section>

              <section data-tour="ks-log">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Recent activity</h3>
                {events.length ? (
                  <ul className="divide-y divide-line rounded-xl border border-line text-[13px]">
                    {events.map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-2">
                        <span className="min-w-0">
                          <span className={`font-medium ${e.action === "pause" ? "text-crit" : "text-ok"}`}>{e.action === "pause" ? "Paused" : "Resumed"}</span>
                          <span className="text-ink-2"> — {e.reason}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-3">
                          {e.actor} · {stamp(e.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[13px] text-ink-3">Never used. Every pause and resume will be listed here with who, when and why.</p>
                )}
              </section>
            </div>

            <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
              Deciding whether the whole build should stop, pause or shrink? Use the{" "}
              <Link href="/decision" onClick={() => setOpen(false)} className="font-medium text-accent hover:underline">
                pre-build decision checklist
              </Link>
              .
            </p>

            <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="text-xs text-ink-3">New here? The walkthrough shows each part of this panel.</p>
              <button
                type="button"
                className={btnSecondary}
                onClick={() => {
                  setOpen(false);
                  startTour("killswitch");
                }}
              >
                Walk me through this
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
