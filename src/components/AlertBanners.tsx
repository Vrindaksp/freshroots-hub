"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acknowledgeAlert } from "@/app/actions";
import type { AlertRow } from "@/lib/alerts/run";
import { ToneIcon, type Tone } from "./ui";

const TYPE_LABEL: Record<string, string> = {
  STOCKOUT_RISK: "stockout risk",
  OVERSTOCK_RISK: "overstock / perishable-window breach",
  HIGH_DEMAND: "high-demand SKU",
  REGIONAL_DROP: "regional order drop",
  REGIONAL_SURGE: "regional order surge",
  METRIC_DEVIATION: "metric deviation",
};

const TONE: Record<AlertRow["severity"], Tone> = { critical: "crit", warning: "warn", info: "info" };
const BANNER: Record<AlertRow["severity"], string> = {
  critical: "border-crit/30 bg-crit-soft text-crit",
  warning: "border-warn/30 bg-warn-soft text-warn",
  info: "border-line bg-info-soft text-info",
};

interface Group {
  key: string;
  severity: AlertRow["severity"];
  type: string;
  items: AlertRow[];
}

function group(alerts: AlertRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const a of alerts) {
    const key = `${a.severity}:${a.type}`;
    if (!map.has(key)) map.set(key, { key, severity: a.severity, type: a.type, items: [] });
    map.get(key)!.items.push(a);
  }
  return [...map.values()];
}

function AlertGroup({ g, onDone }: { g: Group; onDone: (ids: number[]) => void }) {
  const [pending, start] = useTransition();
  const tone = TONE[g.severity];
  const n = g.items.length;
  return (
    <div role={g.severity === "critical" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${BANNER[g.severity]}`}>
      <span className="mt-0.5 shrink-0">
        <ToneIcon tone={tone} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">
          {n} {g.severity === "critical" ? "critical " : ""}
          {TYPE_LABEL[g.type] ?? g.type.toLowerCase()}
          {n > 1 && g.type !== "METRIC_DEVIATION" ? "s" : ""}
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink">
          {g.items.map((a) => (
            <li key={a.id}>
              {a.skuId ? (
                <Link href={`/planner?sku=${a.skuId}`} className="underline decoration-current/30 underline-offset-2 hover:decoration-current" title={a.message}>
                  {a.title}
                </Link>
              ) : (
                <span title={a.message}>{a.title}</span>
              )}
            </li>
          ))}
        </ul>
        {g.items.some((a) => !a.skuId) && <p className="mt-1 text-xs text-ink-2">{g.items.find((a) => !a.skuId)?.message}</p>}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            for (const a of g.items) await acknowledgeAlert(a.id);
            onDone(g.items.map((a) => a.id));
          })
        }
        className="shrink-0 rounded-md border border-current/25 px-2.5 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
      >
        {pending ? "…" : "Acknowledge"}
      </button>
    </div>
  );
}

export function AlertBanners({ alerts }: { alerts: AlertRow[] }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const open = alerts.filter((a) => !a.acknowledged && !dismissed.has(a.id));
  const urgent = group(open.filter((a) => a.severity !== "info"));
  const info = open.filter((a) => a.severity === "info");
  const dismiss = (ids: number[]) => setDismissed((prev) => new Set([...prev, ...ids]));

  if (!urgent.length && !info.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-soft px-4 py-2.5 text-[13px] font-medium text-ok" role="status">
        <ToneIcon tone="ok" size={14} /> No open anomalies — all monitored metrics are inside their thresholds.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {urgent.map((g) => (
        <AlertGroup key={g.key} g={g} onDone={dismiss} />
      ))}
      {info.length > 0 && (
        <details className="rounded-xl border border-line bg-surface px-4 py-2 text-[13px] text-ink-2">
          <summary className="cursor-pointer select-none font-medium">
            {info.length} informational signal{info.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-1">
            {info.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3">
                <span>
                  {a.skuId ? (
                    <Link href={`/planner?sku=${a.skuId}`} className="font-medium text-ink underline decoration-line-strong underline-offset-2">
                      {a.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{a.title}</span>
                  )}
                  <span className="text-ink-3"> — {a.message}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
