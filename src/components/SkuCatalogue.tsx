"use client";

import { useState, useTransition } from "react";
import { addSku, archiveSku, deleteSkuPermanently, restoreSku, updateSku, type SkuResult } from "@/app/sku-actions";
import { syncSkuToZoho } from "@/app/zoho-actions";
import { formatINR, formatNumber } from "@/lib/format";
import type { CatalogueSku, DistributorOption } from "@/lib/skus/queries";
import { RunEngineButton } from "./ActionButtons";
import { Modal } from "./Modal";
import { Badge, btnBase, btnGhost, btnPrimary, btnSecondary, Card } from "./ui";

interface FormState {
  id: string;
  name: string;
  category: string;
  perishability: "High" | "Low";
  standardOrderQty: string;
  unitOfMeasure: string;
  distributorId: string;
  unitCost: string;
  unitPrice: string;
  openingStock: string;
  location: string;
}

const emptyForm = (distributors: DistributorOption[], location: string): FormState => ({
  id: "",
  name: "",
  category: "",
  perishability: "Low",
  standardOrderQty: "",
  unitOfMeasure: "Units",
  distributorId: distributors[0]?.id ?? "",
  unitCost: "",
  unitPrice: "",
  openingStock: "0",
  location,
});

const fromSku = (s: CatalogueSku): FormState => ({
  id: s.id,
  name: s.name,
  category: s.category,
  perishability: s.perishable ? "High" : "Low",
  standardOrderQty: String(s.standardOrderQty),
  unitOfMeasure: s.unitOfMeasure,
  distributorId: s.distributorId ?? "",
  unitCost: s.unitCost == null ? "" : String(s.unitCost),
  unitPrice: s.unitPrice == null ? "" : String(s.unitPrice),
  openingStock: "0",
  location: "",
});

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-[13px]">
      <span className="font-medium text-ink">{label}</span>
      {hint && <span className="ml-1 font-normal text-ink-3">{hint}</span>}
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-1 block text-xs text-crit">{error}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-3";

function SkuFormDialog({
  mode,
  initial,
  distributors,
  categories,
  onClose,
  onDone,
}: {
  mode: "add" | "edit";
  initial: FormState;
  distributors: DistributorOption[];
  categories: string[];
  onClose: () => void;
  onDone: (r: Extract<SkuResult, { ok: true }>) => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  function submit() {
    setError(null);
    setFields({});
    start(async () => {
      const r = mode === "add" ? await addSku(f) : await updateSku(f.id, f);
      if (r.ok) onDone(r);
      else {
        setFields(r.fields ?? {});
        setError(r.fields ? "Please fix the highlighted fields." : r.error);
      }
    });
  }

  return (
    <Modal
      title={mode === "add" ? "Add a SKU" : `Edit ${f.id}`}
      subtitle={mode === "add" ? "It joins the planner after the next planning-engine run." : "Changes apply to recommendations after the next planning-engine run."}
      onClose={onClose}
      footer={
        <>
          {error && <span className="mr-auto text-xs text-crit">{error}</span>}
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={pending} onClick={submit}>
            {pending ? "Saving…" : mode === "add" ? "Add SKU" : "Save changes"}
          </button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === "add" && (
          <Field label="SKU ID" hint="(optional — auto-numbered if empty)" error={fields.id}>
            <input className={inputCls} value={f.id} onChange={(e) => set("id", e.target.value)} placeholder="e.g. SKU016" maxLength={24} />
          </Field>
        )}
        <div className={mode === "add" ? "" : "sm:col-span-2"}>
          <Field label="Name" error={fields.name}>
            <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Freshroots Jaggery 500g" maxLength={120} autoFocus />
          </Field>
        </div>
        <Field label="Category" error={fields.category}>
          <input className={inputCls} list="sku-categories" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Staple" maxLength={40} />
          <datalist id="sku-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Perishability" hint="(High = strict 3–4 week stock window)" error={fields.perishability}>
          <select className={inputCls} value={f.perishability} onChange={(e) => set("perishability", e.target.value as "High" | "Low")}>
            <option value="Low">Low</option>
            <option value="High">High</option>
          </select>
        </Field>
        <Field label="Standard order quantity" error={fields.standardOrderQty}>
          <input className={inputCls} inputMode="numeric" value={f.standardOrderQty} onChange={(e) => set("standardOrderQty", e.target.value)} placeholder="200" />
        </Field>
        <Field label="Unit of measure" error={fields.unitOfMeasure}>
          <input className={inputCls} value={f.unitOfMeasure} onChange={(e) => set("unitOfMeasure", e.target.value)} maxLength={20} />
        </Field>
        <Field label="Distributor" error={fields.distributorId}>
          <select className={inputCls} value={f.distributorId} onChange={(e) => set("distributorId", e.target.value)}>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.region}
              </option>
            ))}
          </select>
        </Field>
        <div className="hidden sm:block" />
        <Field label="Unit cost (₹)" hint="(optional)" error={fields.unitCost}>
          <input className={inputCls} inputMode="decimal" value={f.unitCost} onChange={(e) => set("unitCost", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Unit price (₹)" hint="(optional)" error={fields.unitPrice}>
          <input className={inputCls} inputMode="decimal" value={f.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="0.00" />
        </Field>
        {mode === "add" && (
          <>
            <Field label="Opening stock (units)" error={fields.openingStock}>
              <input className={inputCls} inputMode="numeric" value={f.openingStock} onChange={(e) => set("openingStock", e.target.value)} />
            </Field>
            <Field label="Warehouse" error={fields.location}>
              <input className={inputCls} value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={80} />
            </Field>
          </>
        )}
        <button type="submit" className="sr-only">
          Save
        </button>
      </form>
      {mode === "add" && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
          A new SKU has no sales history yet, so the engine treats it as a <strong>new launch</strong> and sends it to Gemini for review. Push daily sales through <code className="rounded bg-surface px-1">/api/ingest</code> to build its history.
        </p>
      )}
    </Modal>
  );
}

export function SkuCatalogue({
  skus,
  distributors,
  categories,
  locations,
  zohoReady,
}: {
  skus: CatalogueSku[];
  distributors: DistributorOption[];
  categories: string[];
  locations: string[];
  zohoReady: boolean;
}) {
  const [form, setForm] = useState<{ mode: "add" | "edit"; initial: FormState } | null>(null);
  const [removing, setRemoving] = useState<CatalogueSku | null>(null);
  const [deleting, setDeleting] = useState<CatalogueSku | null>(null);
  const [reason, setReason] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; runEngine?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const active = skus.filter((s) => !s.archivedAt);
  const removed = skus.filter((s) => s.archivedAt);
  const visible = showRemoved ? skus : active;

  function run(action: () => Promise<SkuResult>, after?: () => void, runEngine = false) {
    start(async () => {
      const r = await action();
      setNotice({ ok: r.ok, text: r.ok ? r.message : r.error, runEngine: r.ok && runEngine });
      if (r.ok) after?.();
    });
  }

  function syncRow(id: string) {
    setBusyRow(id);
    start(async () => {
      const r = await syncSkuToZoho(id);
      setNotice({ ok: r.ok, text: r.ok ? r.message : r.error });
      setBusyRow(null);
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2" data-tour="sku-add">
        <button type="button" className={btnPrimary} onClick={() => setForm({ mode: "add", initial: emptyForm(distributors, locations[0] ?? "") })}>
          + Add SKU
        </button>
        <span className="text-[13px] text-ink-3">
          {active.length} active{removed.length ? ` · ${removed.length} removed` : ""}
        </span>
        {removed.length > 0 && (
          <label className="ml-2 flex items-center gap-1.5 text-[13px] text-ink-2">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Show removed
          </label>
        )}
      </div>

      {notice && (
        <div role="status" className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-[13px] ${notice.ok ? "border-ok/25 bg-ok-soft text-ink" : "border-crit/30 bg-crit-soft text-crit"}`}>
          <span>{notice.text}</span>
          <span className="flex items-center gap-2">
            {notice.runEngine && <RunEngineButton variant="secondary" />}
            <button type="button" className={btnGhost} onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      <Card tour="sku-table">
        <div className="max-h-[70vh] overflow-auto">
          <table className="grid-table w-full min-w-[1080px] border-separate border-spacing-0 text-left text-[13px]">
            <thead>
              <tr className="text-xs text-ink-2">
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="px-2 py-2.5 font-medium">Category</th>
                <th className="px-2 py-2.5 text-right font-medium">Std lot</th>
                <th className="px-2 py-2.5 font-medium">Distributor</th>
                <th className="px-2 py-2.5 text-right font-medium">On hand</th>
                <th className="px-2 py-2.5 text-right font-medium">Cost / price</th>
                <th className="px-2 py-2.5 font-medium">Zoho</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const isRemoved = Boolean(s.archivedAt);
                const cell = "border-t border-line px-2 py-2.5 align-middle";
                return (
                  <tr key={s.id} className={isRemoved ? "bg-surface-2/60 text-ink-3" : "hover:bg-surface-2/60"}>
                    <td className="border-t border-line px-4 py-2.5 align-middle">
                      <span className={`block font-medium ${isRemoved ? "text-ink-2 line-through" : "text-ink"}`}>{s.name.replace(/^Freshroots /, "")}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        {s.id}
                        {s.perishable && <Badge tone="info">Perishable</Badge>}
                        {s.source === "manual" && <Badge tone="accent">Added manually</Badge>}
                        {isRemoved && <Badge tone="warn">Removed</Badge>}
                        {!isRemoved && !s.inLatestRun && <Badge tone="warn" title="Run the planning engine to include this SKU in the planner">Awaiting engine run</Badge>}
                      </span>
                      {isRemoved && s.archivedReason && <span className="mt-0.5 block text-xs text-ink-3">Reason: {s.archivedReason}</span>}
                    </td>
                    <td className={cell}>{s.category}</td>
                    <td className={`${cell} text-right tabular-nums`}>
                      {formatNumber(s.standardOrderQty)} <span className="text-xs text-ink-3">{s.unitOfMeasure}</span>
                    </td>
                    <td className={cell}>{s.distributorName ?? "—"}</td>
                    <td className={`${cell} text-right tabular-nums`}>{formatNumber(s.onHand)}</td>
                    <td className={`${cell} text-right tabular-nums`}>
                      {s.unitCost != null || s.unitPrice != null ? (
                        <>
                          {s.unitCost != null ? formatINR(s.unitCost) : "—"} / {s.unitPrice != null ? formatINR(s.unitPrice) : "—"}
                          {s.pricingSource === "placeholder" && <span className="ml-1.5 align-middle"><Badge tone="warn" title="Illustrative price, not from your files">Placeholder</Badge></span>}
                        </>
                      ) : (
                        <span className="text-ink-3">not set</span>
                      )}
                    </td>
                    <td className={cell}>
                      {s.zohoItemId ? (
                        <Badge tone="ok" icon title={`Zoho item ${s.zohoItemId}`}>
                          Linked
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-3">Not synced</span>
                      )}
                    </td>
                    <td className="border-t border-line px-4 py-2.5 text-right align-middle">
                      <span className="inline-flex flex-wrap items-center justify-end gap-1">
                        {!isRemoved ? (
                          <>
                            <button type="button" className={`${btnGhost} !px-2 !py-1`} onClick={() => setForm({ mode: "edit", initial: fromSku(s) })}>
                              Edit
                            </button>
                            {zohoReady && (
                              <button type="button" className={`${btnGhost} !px-2 !py-1`} disabled={busyRow === s.id} onClick={() => syncRow(s.id)} title="Create or link this item in Zoho Inventory">
                                {busyRow === s.id ? "Syncing…" : s.zohoItemId ? "Re-sync" : "Sync to Zoho"}
                              </button>
                            )}
                            <button type="button" className={`${btnBase} !px-2 !py-1 text-crit hover:bg-crit-soft`} onClick={() => { setReason(""); setRemoving(s); }}>
                              Remove
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className={`${btnSecondary} !px-2 !py-1`} disabled={pending} onClick={() => run(() => restoreSku(s.id), undefined, true)}>
                              Restore
                            </button>
                            <button
                              type="button"
                              className={`${btnBase} !px-2 !py-1 text-crit hover:bg-crit-soft`}
                              disabled={!s.canDelete}
                              title={s.canDelete ? "Delete permanently" : `Has ${s.salesRows} sales records and ${s.decidedPos} decided POs — kept as history`}
                              onClick={() => { setConfirmId(""); setDeleting(s); }}
                            >
                              Delete…
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-3">
                    No SKUs yet. Add the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {form && (
        <SkuFormDialog
          mode={form.mode}
          initial={form.initial}
          distributors={distributors}
          categories={categories}
          onClose={() => setForm(null)}
          onDone={(r) => {
            setForm(null);
            setNotice({ ok: true, text: r.message, runEngine: true });
          }}
        />
      )}

      {removing && (
        <Modal
          title={`Remove ${removing.id}?`}
          subtitle={removing.name}
          width="max-w-lg"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className={btnGhost} onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${btnBase} bg-crit text-white hover:brightness-110 dark:text-slate-900`}
                disabled={pending || reason.trim().length < 5}
                onClick={() => {
                  const id = removing.id;
                  run(() => archiveSku(id, reason), () => setRemoving(null));
                }}
              >
                {pending ? "Removing…" : "Remove SKU"}
              </button>
            </>
          }
        >
          <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
            <li>It disappears from the planner, the engine, alerts and dashboards.</li>
            <li>Any open <strong>draft</strong> purchase order for it is dropped.</li>
            <li>Its sales history and past purchase orders are kept, and you can restore it later.</li>
            <li>Nothing changes in Zoho.</li>
          </ul>
          <label htmlFor="rm-reason" className="text-[13px] font-medium text-ink">
            Why are you removing it? <span className="font-normal text-ink-3">(kept in the history)</span>
          </label>
          <textarea id="rm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className={`${inputCls} mt-1`} placeholder="e.g. Discontinued by the brand" autoFocus />
        </Modal>
      )}

      {deleting && (
        <Modal
          title={`Delete ${deleting.id} permanently?`}
          subtitle="This cannot be undone."
          width="max-w-lg"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className={btnGhost} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${btnBase} bg-crit text-white hover:brightness-110 dark:text-slate-900`}
                disabled={pending || confirmId.trim() !== deleting.id}
                onClick={() => {
                  const id = deleting.id;
                  const typed = confirmId;
                  run(() => deleteSkuPermanently(id, typed), () => setDeleting(null));
                }}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </button>
            </>
          }
        >
          <p className="mb-3 text-[13px] text-ink-2">
            Allowed because this SKU has no sales history and no decided purchase orders. Its stock record and notes are deleted with it.
          </p>
          <label htmlFor="del-confirm" className="text-[13px] font-medium text-ink">
            Type <code className="rounded bg-surface-2 px-1">{deleting.id}</code> to confirm
          </label>
          <input id="del-confirm" value={confirmId} onChange={(e) => setConfirmId(e.target.value)} className={`${inputCls} mt-1`} autoFocus />
        </Modal>
      )}
    </>
  );
}
