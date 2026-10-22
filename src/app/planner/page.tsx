import { connection } from "next/server";
import { Suspense } from "react";
import { ApproveCleanButton, RunEngineButton } from "@/components/ActionButtons";
import { PlannerWorkbench } from "@/components/PlannerWorkbench";
import { Badge, btnSecondary, Card, CardHeader, PageTitle, Skeleton } from "@/components/ui";
import { geminiConfigured, geminiModelLabel } from "@/lib/ai/gemini";
import { getNotesBySku } from "@/lib/ai/notes";
import { addDays, longDate, mondayOf } from "@/lib/dates";
import { databaseBackend } from "@/lib/db";
import { formatINR, formatINRCompact, formatNumber } from "@/lib/format";
import { getPlannerData, getRecentDecisions } from "@/lib/planner/queries";

export const metadata = { title: "Demand planner view · Freshroots Operations Hub" };

export default function PlannerPage() {
  return (
    <>
      <PageTitle
        title="Demand planning"
        subtitle={
          <Suspense fallback={<Skeleton className="h-4 w-72" />}>
            <RunLine />
          </Suspense>
        }
        actions={
          <>
            <a href="/api/purchase-orders/export?format=csv" className={btnSecondary} download>
              Export approved POs
            </a>
            <ApproveCleanButton />
            <span data-tour="run-engine">
              <RunEngineButton />
            </span>
          </>
        }
      />
      <Suspense
        fallback={
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <PlannerBody />
      </Suspense>
    </>
  );
}

async function RunLine() {
  await connection();
  const { run } = await getPlannerData();
  if (!run) return <span>No engine run yet — run <code className="rounded bg-surface-2 px-1">npm run db:setup</code></span>;
  return (
    <>
      <span>Stock as of {longDate(run.asOf)}</span>
      {run.festival && <Badge tone="accent">Festival month · +{Math.round(run.uplift * 100)}% demand uplift applied before thresholds</Badge>}
      <span className="text-ink-3">· Run #{run.id}</span>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "crit" | "warn" | "accent" | "ok" }) {
  const color = tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow)]">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

async function PlannerBody() {
  await connection();
  const [{ run, rows }, notes, decisions] = await Promise.all([getPlannerData(), getNotesBySku(), getRecentDecisions(8)]);
  if (!run) {
    return (
      <Card className="p-8 text-center text-ink-2">
        <p className="font-medium text-ink">Nothing to plan yet</p>
        <p className="mt-1 text-sm">Load the seed data and run the engine: <code className="rounded bg-surface-2 px-1">npm run db:setup</code></p>
      </Card>
    );
  }

  const drafts = rows.filter((r) => r.po?.status === "draft");
  const draftValue = drafts.reduce((a, r) => a + (r.po!.finalQty * (r.unitCost ?? 0)), 0);
  const approved = rows.filter((r) => r.po?.status === "approved");
  const approvedValue = approved.reduce((a, r) => a + (r.po!.finalQty * (r.unitCost ?? 0)), 0);
  const stockout = rows.filter((r) => r.flags.includes("STOCKOUT_RISK"));
  const overstock = rows.filter((r) => r.flags.includes("OVERSTOCK_RISK"));
  const high = rows.filter((r) => r.flags.includes("HIGH_DEMAND"));
  const edge = rows.filter((r) => r.isEdge);
  const lastWeek = addDays(mondayOf(run.asOf), -7);
  const gemini = geminiConfigured();

  return (
    <div className="space-y-5">
      <div data-tour="planner-tiles" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Draft POs awaiting you" value={String(drafts.length)} sub={`${formatINRCompact(draftValue)} at cost`} tone={drafts.length ? "accent" : undefined} />
        <Tile label="Stockout risk" value={String(stockout.length)} sub={stockout.slice(0, 2).map((r) => r.name.replace(/^Freshroots /, "")).join(", ") || "None"} tone={stockout.length ? "crit" : "ok"} />
        <Tile label="Overstock (orders paused)" value={String(overstock.length)} sub={overstock.map((r) => r.name.replace(/^Freshroots /, "")).join(", ") || "None"} tone={overstock.length ? "warn" : "ok"} />
        <Tile label="High demand" value={String(high.length)} sub={high.map((r) => r.name.replace(/^Freshroots /, "")).join(", ") || "None"} />
        <Tile label="Needs your review" value={String(edge.length)} sub={`${Math.round((edge.length / Math.max(rows.length, 1)) * 100)}% of SKUs are edge cases`} tone={edge.length ? "warn" : undefined} />
        <Tile label="Approved this cycle" value={String(approved.length)} sub={`${formatINRCompact(approvedValue)} staged for Zoho`} tone={approved.length ? "ok" : undefined} />
      </div>

      <PlannerWorkbench rows={rows} notes={notes} lastWeek={lastWeek} geminiOn={gemini} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent decisions" subtitle="Approved POs are staged for Zoho Inventory; overrides carry the reason you gave." />
          {decisions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="text-xs text-ink-3">
                    <th className="px-4 py-2 font-medium">PO</th>
                    <th className="px-2 py-2 font-medium">SKU</th>
                    <th className="px-2 py-2 text-right font-medium">Recommended</th>
                    <th className="px-2 py-2 text-right font-medium">Final</th>
                    <th className="px-2 py-2 text-right font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="px-4 py-2 tabular-nums text-ink-2">FR-PO-{String(d.id).padStart(6, "0")}</td>
                      <td className="px-2 py-2 text-ink">{d.name.replace(/^Freshroots /, "")}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-2">{formatNumber(d.recommendedQty)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{formatNumber(d.finalQty)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{d.estValue != null ? formatINR(d.estValue) : "—"}</td>
                      <td className="px-2 py-2">
                        <Badge tone={d.status === "approved" ? "ok" : "neutral"} icon={d.status === "approved"}>
                          {d.status === "approved" ? `Approved · ${d.zohoStatus.replace("_", " ")}` : "Rejected"}
                        </Badge>
                      </td>
                      <td className="max-w-64 truncate px-4 py-2 text-ink-2" title={d.overrideReason ?? undefined}>
                        {d.overrideReason ?? <span className="text-ink-3">Followed the rules</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm text-ink-3">No decisions yet. Approve or reject a draft above.</p>
          )}
        </Card>

        <Card tour="rules">
          <CardHeader title="Rules in force" subtitle="Defined in src/lib/engine/config.ts" />
          <ul className="space-y-2 p-4 text-[13px] text-ink-2">
            <li><span className="font-medium text-ink">High demand:</span> 4-week average more than 20% over the 12-week average → reorder 1.5× standard quantity.</li>
            <li><span className="font-medium text-ink">Stockout risk:</span> stock under 6 weeks of demand → reorder now.</li>
            <li><span className="font-medium text-ink">Overstock:</span> over 14 weeks → pause orders.</li>
            <li><span className="font-medium text-ink">Festival uplift:</span> +25% demand in Oct, Nov and Mar, applied before every threshold.</li>
            <li><span className="font-medium text-ink">Perishables:</span> strict 3–4 week window instead of 6/14; orders are capped so stock never overshoots it.</li>
            <li className="border-t border-line pt-2 text-xs text-ink-3">
              Commentary: {gemini ? `Gemini (${geminiModelLabel()})` : "rule-based — set GEMINI_API_KEY for Gemini"} · Database: {databaseBackend() === "neon" ? "Neon" : "embedded local Postgres"}
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
