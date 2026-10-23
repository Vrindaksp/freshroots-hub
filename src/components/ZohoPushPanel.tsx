"use client";

import { useState, useTransition } from "react";
import { previewZohoPushAction, pushPurchaseOrdersToZoho, type PushResult } from "@/app/zoho-actions";
import { formatINR, formatNumber } from "@/lib/format";
import type { PushPreviewLine } from "@/lib/zoho/sync";
import { Badge, btnBase, btnPrimary, btnSecondary, Card, CardHeader, ToneIcon } from "./ui";

interface PoRow {
  id: number;
  reference: string;
  skuName: string;
  qty: number;
  status: string;
  zohoNumber: string | null;
  error: string | null;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = { pushed: "ok", failed: "crit", staged: "warn", not_staged: "warn" };
const STATUS_LABEL: Record<string, string> = { pushed: "In Zoho", failed: "Failed", staged: "Ready to push", not_staged: "Ready to push" };

export function ZohoPushPanel({ configured, awaiting, pos }: { configured: boolean; awaiting: number; pos: PoRow[] }) {
  const [preview, setPreview] = useState<PushPreviewLine[] | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"preview" | "push" | null>(null);

  function showPreview() {
    setMode("preview");
    setError(null);
    start(async () => {
      const r = await previewZohoPushAction();
      if (r.ok) setPreview(r.lines);
      else setError(r.error);
      setMode(null);
    });
  }

  function push() {
    if (!window.confirm(`Create ${awaiting} draft purchase order${awaiting === 1 ? "" : "s"} in your Zoho Inventory? Items and vendors that do not exist there yet are created first.`)) return;
    setMode("push");
    setResult(null);
    start(async () => {
      setResult(await pushPurchaseOrdersToZoho());
      setPreview(null);
      setMode(null);
    });
  }

  return (
    <Card tour="zoho-push">
      <CardHeader
        title="Purchase orders → Zoho"
        subtitle="Approved purchase orders are created in Zoho Inventory as drafts, so a person still issues them there. Safe to repeat: a PO already in Zoho is linked, never duplicated."
        right={
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnSecondary} disabled={pending} onClick={showPreview}>
              {mode === "preview" ? "Building…" : "Preview what will be sent"}
            </button>
            <button type="button" className={btnPrimary} disabled={pending || !configured || awaiting === 0} onClick={push} title={!configured ? "Connect Zoho first" : awaiting === 0 ? "Nothing waiting to be pushed" : undefined}>
              {mode === "push" ? "Pushing…" : `Push ${awaiting} to Zoho`}
            </button>
          </span>
        }
      />

      {(result || error) && (
        <div role="status" className={`border-b border-line px-4 py-3 text-[13px] ${result?.ok === false || error ? "bg-crit-soft text-crit" : "bg-ok-soft text-ink"}`}>
          {error ?? (result?.ok ? result.message : result?.error)}
          {result?.outcomes && result.outcomes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {result.outcomes.map((o) => (
                <li key={o.poId} className={o.ok ? "text-ink-2" : "text-crit"}>
                  {o.reference}: {o.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <div className="border-b border-line bg-surface-2/50 px-4 py-3">
          <p className="mb-2 text-[13px] font-medium text-ink">
            {preview.length ? `${preview.length} purchase order${preview.length === 1 ? "" : "s"} would be sent. Nothing has been sent yet.` : "Nothing to send: no approved purchase order is waiting."}
          </p>
          <div className="space-y-2">
            {preview.map((l) => (
              <details key={l.poId} className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
                <summary className="cursor-pointer select-none">
                  <span className="font-medium text-ink">{l.reference}</span>
                  <span className="text-ink-2">
                    {" "}
                    · {l.skuName.replace(/^Freshroots /, "")} · {formatNumber(l.quantity)} × {formatINR(l.rate)} · vendor {l.vendor ?? "—"}
                  </span>
                  {l.warnings.length > 0 && <span className="ml-2 align-middle"><Badge tone="warn" icon>{l.warnings.length} note{l.warnings.length > 1 ? "s" : ""}</Badge></span>}
                </summary>
                {l.warnings.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-warn">
                    {l.warnings.map((w) => (
                      <li key={w} className="flex gap-1.5">
                        <ToneIcon tone="warn" size={12} /> {w}
                      </li>
                    ))}
                  </ul>
                )}
                <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-2">{JSON.stringify(l.payload, null, 2)}</pre>
              </details>
            ))}
          </div>
          <button type="button" className={`${btnBase} mt-2 text-ink-3 hover:text-ink`} onClick={() => setPreview(null)}>
            Hide preview
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-2 py-2 font-medium">SKU</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Zoho</th>
              <th className="px-4 py-2 font-medium">Zoho PO / detail</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-2 tabular-nums text-ink-2">{p.reference}</td>
                <td className="px-2 py-2 text-ink">{p.skuName.replace(/^Freshroots /, "")}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink">{formatNumber(p.qty)}</td>
                <td className="px-2 py-2">
                  <Badge tone={STATUS_TONE[p.status] ?? "neutral"} icon={p.status === "pushed" || p.status === "failed"}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
                </td>
                <td className="max-w-80 px-4 py-2 text-ink-2">
                  {p.zohoNumber ? p.zohoNumber : p.error ? <span className="text-crit">{p.error}</span> : <span className="text-ink-3">—</span>}
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-3">
                  No approved purchase orders yet. Approve drafts in the Demand planner view and they appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
