"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { requestCommentary, submitPlannerNote, type ActionResult } from "@/app/actions";
import { RECOMMENDATION_LABEL, NOTE_TYPE_LABEL } from "@/lib/ai/labels";
import type { StoredNote } from "@/lib/ai/notes";
import { EDGE_LABELS } from "@/lib/engine/config";
import { formatINR, formatNumber, formatPctDelta } from "@/lib/format";
import type { PlannerRow } from "@/lib/planner/queries";
import { FlagBadges } from "./FlagBadges";
import { CoverBar, WeeklyBars } from "./PlannerParts";
import { Badge, btnGhost, btnSecondary, Card } from "./ui";

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="text-[15px] font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return {
    pending,
    msg,
    run: (fn: () => Promise<ActionResult>) =>
      start(async () => {
        setMsg(await fn());
      }),
  };
}

export function SkuDrawer({
  row,
  notes,
  lastWeek,
  geminiOn,
  onClose,
  onUseQty,
}: {
  row: PlannerRow;
  notes: StoredNote[];
  lastWeek: string;
  geminiOn: boolean;
  onClose: () => void;
  onUseQty: (skuId: string, qty: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState("");
  const ai = useAction();
  const noteAction = useAction();

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, row.skuId]);

  const c = row.commentary;
  const draft = row.po?.status === "draft";

  return (
    <aside
      role="dialog"
      aria-label={`${row.name} details`}
      className="fixed inset-y-0 right-0 top-14 z-30 flex w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[480px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink">{row.name.replace(/^Freshroots /, "")}</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            {row.skuId} · {row.category} · {row.distributor ?? "No distributor"}
            {row.region ? ` (${row.region})` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <FlagBadges flags={row.flags} />
            {row.perishable && <Badge tone="info">High perishability</Badge>}
          </div>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close details" className={`${btnGhost} !px-2`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="On hand" value={formatNumber(row.onHand)} sub={row.openPoUnits ? `+${formatNumber(row.openPoUnits)} on order` : undefined} />
          <Fact label="Demand / wk" value={formatNumber(row.effective, 1)} sub={`12-wk avg ${formatNumber(row.avg12, 1)}`} />
          <Fact label="4w vs 12w" value={formatPctDelta(row.trend)} sub={`4-wk avg ${formatNumber(row.avg4, 1)}`} />
          <Fact label="Std. lot" value={formatNumber(row.standardOrderQty)} sub={row.uom} />
        </div>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Cover</h3>
          <CoverBar cover={row.cover} low={row.lowWeeks} high={row.highWeeks} />
          <p className="mt-1 text-xs text-ink-3">
            Healthy window {row.lowWeeks}–{row.highWeeks} weeks{row.perishable ? " (strict perishable window)" : ""}.
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Weekly sales</h3>
          <WeeklyBars values={row.weekly} lastWeek={lastWeek} avg4={row.avg4} avg12={row.avg12} />
          <p className="text-[11px] text-ink-3">Highlighted bars are the last four weeks.</p>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">How the rules got here</h3>
          <ol className="list-decimal space-y-1 pl-4 text-[13px] text-ink-2 marker:text-ink-3">
            {row.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Review commentary</h3>
            <button type="button" disabled={ai.pending} onClick={() => ai.run(() => requestCommentary(row.skuId))} className={`${btnSecondary} !py-1 !text-xs`}>
              {ai.pending ? "Thinking…" : c ? "Regenerate" : geminiOn ? "Ask Gemini" : "Generate (rule-based)"}
            </button>
          </div>

          {row.isEdge && (
            <p className="mb-2 flex flex-wrap gap-1.5">
              {row.edgeReasons.map((e) => (
                <Badge key={e} tone="warn" icon>
                  {EDGE_LABELS[e]}
                </Badge>
              ))}
            </p>
          )}

          {c ? (
            <Card as="div" className="space-y-2.5 p-3.5 text-[13px]">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-snug text-ink">{c.content.headline}</p>
                <Badge tone={c.source === "gemini" ? "accent" : "neutral"}>{c.source === "gemini" ? `Gemini · ${c.model}` : "Rule-based"}</Badge>
              </div>
              <p className="text-ink-2">{c.content.assessment}</p>
              {c.content.likely_drivers.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-ink-2">
                  {c.content.likely_drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                <Badge tone={c.content.recommendation === "accept_rule_quantity" ? "ok" : "warn"} icon>
                  {RECOMMENDATION_LABEL[c.content.recommendation]}
                </Badge>
                <span className="text-xs text-ink-3">confidence {c.content.confidence}</span>
                {c.content.suggested_qty != null && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-ink-2">
                      Suggests <strong className="tabular-nums text-ink">{formatNumber(c.content.suggested_qty)}</strong> (rules: {formatNumber(row.recommendedQty)})
                    </span>
                    {draft && (
                      <button type="button" className={`${btnSecondary} !py-1 !text-xs`} onClick={() => onUseQty(row.skuId, c.content.suggested_qty!)}>
                        Use quantity
                      </button>
                    )}
                  </span>
                )}
              </div>
              {c.content.questions_for_planner.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink-3">Check before sign-off</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-ink-2">
                    {c.content.questions_for_planner.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              {c.content.note && <p className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-3">{c.content.note}</p>}
            </Card>
          ) : (
            <p className="text-[13px] text-ink-3">{row.isEdge ? "Commentary is generated when the engine runs." : "This SKU follows the rules cleanly. Ask for commentary any time."}</p>
          )}
          {ai.msg && !ai.msg.ok && <p className="mt-1 text-xs text-crit">{ai.msg.error}</p>}
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Planner notes</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              noteAction.run(async () => {
                const r = await submitPlannerNote(row.skuId, note);
                if (r.ok) setNote("");
                return r;
              });
            }}
          >
            <label htmlFor="note" className="sr-only">
              Note about {row.name}
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Pune distributor says a Diwali scheme runs for 3 weeks, expect +30% on this SKU"
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-xs text-ink-3">{geminiOn ? "Gemini turns free text into structured signals." : "Rule-based parsing (add GEMINI_API_KEY for Gemini)."} Notes inform you — they never change a PO on their own.</p>
              <button type="submit" disabled={noteAction.pending || !note.trim()} className={`${btnSecondary} shrink-0 !py-1 !text-xs`}>
                {noteAction.pending ? "Parsing…" : "Save note"}
              </button>
            </div>
            {noteAction.msg && !noteAction.msg.ok && <p className="mt-1 text-xs text-crit">{noteAction.msg.error}</p>}
          </form>

          {notes.length > 0 && (
            <ul className="mt-3 space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
                  <p className="text-ink">{n.raw}</p>
                  {n.parsed && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-xs text-ink-2">{n.parsed.summary}</p>
                      <p className="flex flex-wrap gap-1.5">
                        {n.parsed.signals.map((s, i) => (
                          <Badge key={i} tone={s.type === "supply_delay" || s.type === "quality_issue" ? "warn" : s.type === "demand_down" ? "info" : "accent"}>
                            {NOTE_TYPE_LABEL[s.type] ?? s.type}
                            {s.magnitude_pct != null ? ` ${s.magnitude_pct > 0 ? "+" : ""}${s.magnitude_pct}%` : ""}
                            {s.duration_weeks != null ? ` · ${s.duration_weeks} wk` : ""}
                          </Badge>
                        ))}
                        {n.parsed.needs_followup && <Badge tone="warn">Needs follow-up</Badge>}
                      </p>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-ink-3">{n.source === "gemini" ? "Parsed by Gemini" : "Rule-based parse"}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {row.po && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Purchase order</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-3">Status</dt>
              <dd className="font-medium capitalize text-ink">{row.po.status}</dd>
              <dt className="text-ink-3">Recommended</dt>
              <dd className="tabular-nums text-ink">{formatNumber(row.po.recommendedQty)}</dd>
              <dt className="text-ink-3">Final</dt>
              <dd className="tabular-nums text-ink">{formatNumber(row.po.finalQty)}</dd>
              <dt className="text-ink-3">Est. value</dt>
              <dd className="tabular-nums text-ink">{row.po.estValue != null ? formatINR(row.po.estValue) : "—"}</dd>
              <dt className="text-ink-3">Zoho staging</dt>
              <dd className="text-ink">{row.po.zohoStatus.replace("_", " ")}</dd>
              {row.po.overrideReason && (
                <>
                  <dt className="text-ink-3">Reason</dt>
                  <dd className="text-ink">{row.po.overrideReason}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </div>
    </aside>
  );
}
