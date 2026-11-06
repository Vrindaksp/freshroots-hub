"use client";

import { useMemo, useState, useTransition } from "react";
import { recordBuildDecision, saveCheckAnswer } from "@/app/decision-actions";
import { AREAS, CHECKS, type CheckKey } from "@/lib/decision/checks";
import { OUTCOMES, OUTCOME_LABEL, STATUS_LABEL, suggestOutcome, type Outcome, type Status } from "@/lib/decision/logic";
import type { DecisionRecord, StoredAnswer } from "@/lib/decision/store";
import { Badge, btnBase, btnPrimary, Card, CardHeader, ToneIcon, type Tone } from "./ui";

const STATUS_TONE: Record<Status, Tone> = { pass: "ok", partial: "warn", fail: "crit", unassessed: "neutral" };
const OUTCOME_TONE: Record<Outcome, Tone> = { continue: "ok", pause: "warn", rebuild_smaller: "accent", stop_build: "crit" };
const STATUS_ORDER: Status[] = ["pass", "partial", "fail", "unassessed"];

const SEG_ACTIVE: Record<Status, string> = {
  pass: "bg-ok-soft text-ok ring-1 ring-ok/40",
  partial: "bg-warn-soft text-warn ring-1 ring-warn/40",
  fail: "bg-crit-soft text-crit ring-1 ring-crit/40",
  unassessed: "bg-surface-2 text-ink-2 ring-1 ring-line-strong",
};

function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function DecisionBoard({
  initial,
  evidence,
  history,
  paused,
}: {
  initial: Record<CheckKey, StoredAnswer>;
  evidence: Record<CheckKey, string[]>;
  history: DecisionRecord[];
  paused: boolean;
}) {
  const [answers, setAnswers] = useState(initial);
  const [saved, setSaved] = useState<Partial<Record<CheckKey, "saving" | "saved" | "error">>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reason, setReason] = useState("");
  const [alsoPause, setAlsoPause] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const suggestion = useMemo(() => suggestOutcome(Object.fromEntries(CHECKS.map((c) => [c.key, answers[c.key].status]))), [answers]);
  const last = history[0];

  function persist(key: CheckKey, status: Status, note: string) {
    setSaved((s) => ({ ...s, [key]: "saving" }));
    void saveCheckAnswer({ key, status, note }).then((r) => setSaved((s) => ({ ...s, [key]: r.ok ? "saved" : "error" })));
  }

  function setStatus(key: CheckKey, status: Status) {
    setAnswers((a) => ({ ...a, [key]: { ...a[key], status } }));
    persist(key, status, answers[key].note);
  }

  function pick(o: Outcome) {
    setOutcome(o);
    setAlsoPause((o === "pause" || o === "stop_build") && !paused);
    setResult(null);
  }

  function record() {
    if (!outcome) return;
    start(async () => {
      const r = await recordBuildDecision({ outcome, reason, alsoPause });
      setResult({ ok: r.ok, text: r.ok ? r.message : r.error });
      if (r.ok) {
        setReason("");
        setOutcome(null);
        setAlsoPause(false);
      }
    });
  }

  const differs = outcome && suggestion.outcome && outcome !== suggestion.outcome;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow)]">
          <p className="text-xs text-ink-3">Checks passed</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight text-ink">
            {suggestion.passed} <span className="text-lg font-normal text-ink-3">/ {suggestion.total}</span>
          </p>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${suggestion.passed} pass, ${suggestion.partial} partial, ${suggestion.failed} fail, ${suggestion.unassessed} not assessed`}>
            <span className="bg-ok" style={{ width: `${(suggestion.passed / suggestion.total) * 100}%` }} />
            <span className="bg-warn" style={{ width: `${(suggestion.partial / suggestion.total) * 100}%` }} />
            <span className="bg-crit" style={{ width: `${(suggestion.failed / suggestion.total) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            {suggestion.partial} partial · {suggestion.failed} fail · {suggestion.unassessed} not assessed
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow)]">
          <p className="text-xs text-ink-3">Suggested outcome</p>
          <div className="mt-1.5">
            {suggestion.outcome ? (
              <Badge tone={OUTCOME_TONE[suggestion.outcome]} icon={suggestion.outcome !== "rebuild_smaller"} className="!px-2 !py-1 !text-[13px]">
                {OUTCOME_LABEL[suggestion.outcome]}
              </Badge>
            ) : (
              <Badge tone="neutral" className="!px-2 !py-1 !text-[13px]">
                Not enough answers yet
              </Badge>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-2">{suggestion.why}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow)]">
          <p className="text-xs text-ink-3">Last decision</p>
          {last ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={OUTCOME_TONE[last.outcome]} className="!px-2 !py-1 !text-[13px]">
                  {OUTCOME_LABEL[last.outcome]}
                </Badge>
                <span className="text-xs text-ink-3">{stamp(last.createdAt)}</span>
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-ink-2">{last.reason}</p>
            </>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-3">No decision recorded yet.</p>
          )}
        </div>
      </div>

      <div data-tour="decision-checks" className="space-y-5">
        {AREAS.map((area) => (
          <section key={area} aria-labelledby={`area-${area}`}>
            <h2 id={`area-${area}`} className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              {area}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {CHECKS.filter((c) => c.area === area).map((c) => {
                const a = answers[c.key];
                const state = saved[c.key];
                return (
                  <Card key={c.key} as="article" className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[14px] font-semibold text-ink">{c.question}</h3>
                      <span className="shrink-0 text-xs text-ink-3" aria-live="polite">
                        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? <span className="text-crit">Not saved</span> : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-3">Pass looks like: {c.good}</p>

                    <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">From the system, right now</p>
                      <ul className="space-y-1 text-[13px] text-ink-2">
                        {evidence[c.key].map((line) => (
                          <li key={line} className="flex gap-2">
                            <span className="text-ink-3" aria-hidden>
                              •
                            </span>
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div role="radiogroup" aria-label={`Answer for: ${c.question}`} className="mt-3 flex flex-wrap gap-1.5">
                      {STATUS_ORDER.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={a.status === s}
                          onClick={() => setStatus(c.key, s)}
                          className={`${btnBase} !px-2.5 !py-1 ${a.status === s ? SEG_ACTIVE[s] : "border border-line text-ink-2 hover:bg-surface-2"}`}
                        >
                          {a.status === s && STATUS_TONE[s] !== "neutral" && <ToneIcon tone={STATUS_TONE[s]} size={12} />}
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>

                    <label htmlFor={`note-${c.key}`} className="sr-only">
                      Your evidence note for: {c.question}
                    </label>
                    <textarea
                      id={`note-${c.key}`}
                      value={a.note}
                      onChange={(e) => setAnswers((p) => ({ ...p, [c.key]: { ...p[c.key], note: e.target.value } }))}
                      onBlur={() => persist(c.key, a.status, a.note)}
                      rows={2}
                      maxLength={500}
                      placeholder="Your evidence or reasoning (saved when you click away)"
                      className="mt-2 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
                    />
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Card tour="decision-outcome">
        <CardHeader title="Record the decision" subtitle="The checklist suggests; a person decides and says why. This is the go / no-go call on the whole build." />
        <div className="space-y-4 p-4">
          <div role="radiogroup" aria-label="Decision outcome" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {OUTCOMES.map((o) => {
              const active = outcome === o.id;
              const suggested = suggestion.outcome === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => pick(o.id)}
                  className={`rounded-xl border p-3 text-left transition ${active ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line hover:bg-surface-2"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <Badge tone={OUTCOME_TONE[o.id]}>{o.label}</Badge>
                    {suggested && <span className="text-[11px] font-medium text-ink-3">suggested</span>}
                  </span>
                  <span className="mt-1.5 block text-xs text-ink-2">{o.blurb}</span>
                </button>
              );
            })}
          </div>

          {differs && (
            <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <span className="mt-0.5">
                <ToneIcon tone="warn" size={14} />
              </span>
              You chose {OUTCOME_LABEL[outcome!]}, but the checklist suggests {OUTCOME_LABEL[suggestion.outcome!]}. That is allowed; say why in the reason.
            </p>
          )}
          {outcome && !suggestion.outcome && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">Some checks are not assessed yet. You can still record a decision, and the snapshot will show which were open.</p>
          )}

          <div>
            <label htmlFor="decision-reason" className="text-[13px] font-medium text-ink">
              Reason <span className="font-normal text-ink-3">(kept with a snapshot of all nine checks)</span>
            </label>
            <textarea
              id="decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Stock data is two weeks stale and prices are placeholders; pausing until both are real."
              className="mt-1 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
            />
          </div>

          {(outcome === "pause" || outcome === "stop_build") && (
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={alsoPause} disabled={paused} onChange={(e) => setAlsoPause(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
              <span>
                {paused ? "Automation is already paused." : "Also pause all automation now (the kill switch)."}{" "}
                <span className="text-ink-3">Stops the engine, Gemini, PO sign-off and Zoho pushes until someone resumes it.</span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnPrimary} disabled={pending || !outcome || reason.trim().length < 10} onClick={record}>
              {pending ? "Recording…" : outcome ? `Record ${OUTCOME_LABEL[outcome]}` : "Choose an outcome"}
            </button>
            {result && (
              <span role="status" className={`text-[13px] ${result.ok ? "text-ok" : "text-crit"}`}>
                {result.text}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Decision history" subtitle="Append-only. Each entry freezes the nine answers as they stood." />
        {history.length ? (
          <ul className="divide-y divide-line">
            {history.map((d) => (
              <li key={d.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={OUTCOME_TONE[d.outcome]}>{OUTCOME_LABEL[d.outcome]}</Badge>
                  <span className="text-ink-3">
                    {stamp(d.createdAt)} · {d.actor} · {d.scorePass}/{d.scoreTotal} passed
                  </span>
                  {d.suggested && d.suggested !== d.outcome && <Badge tone="warn">checklist suggested {OUTCOME_LABEL[d.suggested]}</Badge>}
                  {d.alsoPaused && <Badge tone="crit">paused automation</Badge>}
                </div>
                <p className="mt-1 text-ink-2">{d.reason}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-xs text-ink-3">Answers at the time</summary>
                  <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {d.snapshot.map((s) => (
                      <li key={s.key} className="flex items-start gap-2 text-xs text-ink-2">
                        <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                        <span>
                          {s.question}
                          {s.note && <span className="block text-ink-3">{s.note}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-[13px] text-ink-3">Nothing recorded yet.</p>
        )}
      </Card>
    </div>
  );
}
