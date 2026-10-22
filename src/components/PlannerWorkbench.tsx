"use client";

import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useMemo, useState, useTransition } from "react";
import { decidePo } from "@/app/actions";
import type { StoredNote } from "@/lib/ai/notes";
import { EDGE_LABELS } from "@/lib/engine/config";
import { formatINR, formatNumber, formatPctDelta } from "@/lib/format";
import type { PlannerRow } from "@/lib/planner/queries";
import { ActionBadge, FlagBadges } from "./FlagBadges";
import { CoverBar } from "./PlannerParts";
import { SkuDrawer } from "./SkuDrawer";
import { Badge, btnGhost, btnPrimary, Card, ToneIcon } from "./ui";

type Filter = "all" | "action" | "stockout" | "overstock" | "high" | "edge" | "perishable" | "decided";
type Sort = "priority" | "cover" | "value" | "sku";

const FILTERS: { id: Filter; label: string; test: (r: PlannerRow) => boolean }[] = [
  { id: "all", label: "All SKUs", test: () => true },
  { id: "action", label: "Needs decision", test: (r) => r.po?.status === "draft" },
  { id: "stockout", label: "Stockout risk", test: (r) => r.flags.includes("STOCKOUT_RISK") },
  { id: "overstock", label: "Overstock", test: (r) => r.flags.includes("OVERSTOCK_RISK") },
  { id: "high", label: "High demand", test: (r) => r.flags.includes("HIGH_DEMAND") },
  { id: "edge", label: "Review (edge cases)", test: (r) => r.isEdge },
  { id: "perishable", label: "Perishable", test: (r) => r.perishable },
  { id: "decided", label: "Decided", test: (r) => r.po != null && r.po.status !== "draft" },
];

function priority(r: PlannerRow): number {
  const base = r.po?.status === "draft" ? 0 : r.action === "pause" ? 20 : r.flags.includes("HIGH_DEMAND") ? 30 : r.po ? 40 : 50;
  return base + Math.min(r.cover ?? 99, 49) / 100;
}

interface Edit {
  qty: string;
  reason: string;
  mode: "approve" | "reject" | null;
  error?: string;
}

export function PlannerWorkbench({
  rows,
  notes,
  lastWeek,
  geminiOn,
}: {
  rows: PlannerRow[];
  notes: Record<string, StoredNote[]>;
  lastWeek: string;
  geminiOn: boolean;
}) {
  const params = useSearchParams();
  const skuParam = params.get("sku");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const [openSku, setOpenSku] = useState<string | null>(skuParam);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  // Follow ?sku= changes (e.g. arriving from an alert link) without an effect: adjust state while rendering.
  const [seenParam, setSeenParam] = useState(skuParam);
  if (skuParam !== seenParam) {
    setSeenParam(skuParam);
    if (skuParam) setOpenSku(skuParam);
  }

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.test).length])) as Record<Filter, number>, [rows]);

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const list = rows.filter(test);
    const key: Record<Sort, (r: PlannerRow) => number | string> = {
      priority,
      cover: (r) => r.cover ?? 999,
      value: (r) => -(r.po?.estValue ?? 0),
      sku: (r) => r.skuId,
    };
    return [...list].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : key[sort](a) > key[sort](b) ? 1 : 0));
  }, [rows, filter, sort]);

  const edit = (r: PlannerRow): Edit => edits[r.skuId] ?? { qty: String(r.po?.finalQty ?? r.recommendedQty), reason: "", mode: null };
  const patch = useCallback((skuId: string, base: Edit, p: Partial<Edit>) => setEdits((prev) => ({ ...prev, [skuId]: { ...base, ...(prev[skuId] ?? {}), ...p } })), []);

  function submit(r: PlannerRow, decision: "approve" | "reject") {
    const e = edit(r);
    const po = r.po;
    if (!po || po.status !== "draft") return;
    const qty = Number(e.qty);
    const changed = decision === "approve" && qty !== po.recommendedQty;
    if ((changed || decision === "reject") && e.reason.trim().length < 5) {
      patch(r.skuId, e, { mode: decision, error: decision === "reject" ? "Say why you are rejecting this recommendation." : `You changed ${formatNumber(po.recommendedQty)} to ${formatNumber(qty)} — add a reason.` });
      return;
    }
    setBusy(r.skuId);
    start(async () => {
      const result = await decidePo({ id: po.id, decision, finalQty: qty, reason: e.reason });
      setBusy(null);
      if (result.ok) setEdits((prev) => ({ ...prev, [r.skuId]: { qty: String(qty), reason: "", mode: null } }));
      else patch(r.skuId, e, { error: result.error, mode: e.mode ?? (changed ? "approve" : null) });
    });
  }

  const open = rows.find((r) => r.skuId === openSku) ?? null;
  const closeDrawer = useCallback(() => setOpenSku(null), []);

  return (
    <>
      {/* On wide screens the grid makes room for the drawer so the Decision column stays reachable. */}
      <Card tour="grid" className={open ? "xl:mr-[480px]" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div role="tablist" aria-label="Filter SKUs" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${filter === f.id ? "bg-navy text-white dark:bg-accent dark:text-accent-ink" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {f.label} <span className={filter === f.id ? "opacity-70" : "text-ink-3"}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-3">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink">
              <option value="priority">Priority</option>
              <option value="cover">Cover (lowest first)</option>
              <option value="value">PO value</option>
              <option value="sku">SKU</option>
            </select>
          </label>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="grid-table w-full min-w-[1120px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr className="text-xs text-ink-2">
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="px-2 py-2.5 text-right font-medium">On hand</th>
                <th className="px-2 py-2.5 text-right font-medium" title="12-week average with festival uplift">
                  Demand/wk
                </th>
                <th className="px-2 py-2.5 font-medium">Cover (weeks)</th>
                <th className="px-2 py-2.5 text-right font-medium" title="4-week average vs 12-week average">
                  4w vs 12w
                </th>
                <th className="px-2 py-2.5 font-medium">Signals</th>
                <th className="px-2 py-2.5 font-medium">Engine</th>
                <th className="px-2 py-2.5 text-right font-medium">Recommended</th>
                <th className="px-2 py-2.5 text-right font-medium">Final qty</th>
                <th className="px-2 py-2.5 text-right font-medium">Est. value</th>
                <th className="px-4 py-2.5 text-right font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const e = edit(r);
                const po = r.po;
                const draft = po?.status === "draft";
                const qty = Number(e.qty);
                const changed = draft && qty !== po!.recommendedQty;
                const showReason = draft && (e.mode != null || (changed && e.error));
                const cell = "border-t border-line px-2 py-2.5 align-middle";
                return (
                  <Fragment key={r.skuId}>
                    <tr className={openSku === r.skuId ? "bg-accent-soft/60" : "hover:bg-surface-2/60"}>
                      <td className="border-t border-line px-4 py-2.5 align-middle">
                        <button type="button" onClick={() => setOpenSku(r.skuId)} className="text-left" aria-label={`Open details for ${r.name}`}>
                          <span className="block font-medium text-ink hover:text-accent hover:underline">{r.name.replace(/^Freshroots /, "")}</span>
                          <span className="block text-xs text-ink-3">
                            {r.skuId} · {r.category}
                            {r.perishable ? " · perishable" : ""}
                          </span>
                        </button>
                      </td>
                      <td className={`${cell} text-right tabular-nums text-ink`}>{formatNumber(r.onHand)}</td>
                      <td className={`${cell} text-right tabular-nums text-ink`}>{formatNumber(r.effective, 1)}</td>
                      <td className={cell}>
                        <CoverBar cover={r.cover} low={r.lowWeeks} high={r.highWeeks} />
                      </td>
                      <td className={`${cell} text-right tabular-nums ${r.trend > 0.2 ? "font-medium text-accent" : r.trend < -0.1 ? "text-warn" : "text-ink-2"}`}>{formatPctDelta(r.trend)}</td>
                      <td className={cell}>
                        <div className="flex flex-col gap-1">
                          <FlagBadges flags={r.flags} hide={["SEASONAL_UPLIFT"]} />
                          {r.isEdge && (
                            <span title={r.edgeReasons.map((x) => EDGE_LABELS[x]).join(", ")}>
                              <Badge tone="warn" icon>
                                Review: {EDGE_LABELS[r.edgeReasons[0]].toLowerCase()}
                              </Badge>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cell}>
                        <ActionBadge action={r.action} />
                      </td>
                      <td className={`${cell} text-right tabular-nums text-ink`}>{po ? formatNumber(po.recommendedQty) : <span className="text-ink-3">—</span>}</td>
                      <td className={`${cell} text-right`}>
                        {draft ? (
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={e.qty}
                            aria-label={`Final quantity for ${r.name}`}
                            onChange={(ev) => patch(r.skuId, e, { qty: ev.target.value, error: undefined })}
                            className={`w-24 rounded-md border bg-surface px-2 py-1 text-right tabular-nums text-ink ${changed ? "border-warn ring-1 ring-warn/40" : "border-line-strong"}`}
                          />
                        ) : po ? (
                          <span className="tabular-nums text-ink">{formatNumber(po.finalQty)}</span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={`${cell} text-right tabular-nums text-ink`}>
                        {po && r.unitCost != null ? formatINR((draft ? qty : po.finalQty) * r.unitCost) : "—"}
                      </td>
                      <td className="border-t border-line px-4 py-2.5 text-right align-middle">
                        {draft ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button type="button" disabled={busy === r.skuId} onClick={() => submit(r, "approve")} className={`${btnPrimary} !px-2.5 !py-1`}>
                              {busy === r.skuId ? "…" : changed ? "Approve override" : "Approve"}
                            </button>
                            <button type="button" disabled={busy === r.skuId} onClick={() => (e.mode === "reject" ? submit(r, "reject") : patch(r.skuId, e, { mode: "reject", error: undefined }))} className={`${btnGhost} !px-2.5 !py-1`}>
                              Reject
                            </button>
                          </span>
                        ) : po ? (
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <Badge tone={po.status === "approved" ? "ok" : "neutral"} icon={po.status === "approved"}>
                              {po.status === "approved" ? "Approved" : "Rejected"}
                            </Badge>
                            {po.status === "approved" && <span className="text-[11px] text-ink-3">Staged for Zoho</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-3">{r.action === "pause" ? "Paused" : "No order"}</span>
                        )}
                      </td>
                    </tr>
                    {showReason && (
                      <tr className="bg-warn-soft/50">
                        <td colSpan={11} className="border-t border-line px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mt-0.5 text-warn">
                              <ToneIcon tone="warn" size={14} />
                            </span>
                            <label htmlFor={`reason-${r.skuId}`} className="text-[13px] font-medium text-ink">
                              {e.mode === "reject" ? "Why reject this recommendation?" : `Why ${formatNumber(qty)} instead of ${formatNumber(po!.recommendedQty)}?`}
                            </label>
                            <input
                              id={`reason-${r.skuId}`}
                              autoFocus
                              value={e.reason}
                              onChange={(ev) => patch(r.skuId, e, { reason: ev.target.value, error: undefined })}
                              onKeyDown={(ev) => ev.key === "Enter" && submit(r, e.mode === "reject" ? "reject" : "approve")}
                              placeholder="Recorded with the PO for audit"
                              className="min-w-64 flex-1 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-ink placeholder:text-ink-3"
                            />
                            <button type="button" className={`${btnPrimary} !py-1`} disabled={busy === r.skuId} onClick={() => submit(r, e.mode === "reject" ? "reject" : "approve")}>
                              {e.mode === "reject" ? "Confirm reject" : "Confirm approve"}
                            </button>
                            <button type="button" className={`${btnGhost} !py-1`} onClick={() => patch(r.skuId, e, { mode: null, error: undefined, qty: String(po!.recommendedQty), reason: "" })}>
                              Cancel
                            </button>
                          </div>
                          {e.error && <p className="mt-1 pl-6 text-xs text-crit">{e.error}</p>}
                        </td>
                      </tr>
                    )}
                    {draft && e.error && !showReason && (
                      <tr>
                        <td colSpan={11} className="border-t border-line bg-crit-soft/50 px-4 py-1.5 text-xs text-crit">
                          {r.name.replace(/^Freshroots /, "")}: {e.error}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-ink-3">
                    No SKUs match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {open && (
        <SkuDrawer
          key={open.skuId}
          row={open}
          notes={notes[open.skuId] ?? []}
          lastWeek={lastWeek}
          geminiOn={geminiOn}
          onClose={closeDrawer}
          onUseQty={(skuId, q) => {
            const r = rows.find((x) => x.skuId === skuId);
            if (r) patch(skuId, edit(r), { qty: String(q), error: undefined });
          }}
        />
      )}
    </>
  );
}
