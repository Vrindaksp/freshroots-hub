import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateBriefButton, LiveRefresh, RunEngineButton } from "@/components/ActionButtons";
import { AlertBanners } from "@/components/AlertBanners";
import { ActionBadge, FlagBadges } from "@/components/FlagBadges";
import { MetricCard } from "@/components/MetricCard";
import { RegionTrend } from "@/components/RegionTrend";
import { Sparkline } from "@/components/Sparkline";
import { Badge, Card, CardHeader, PageTitle, SectionSkeleton, Skeleton, ToneIcon } from "@/components/ui";
import { getLatestBrief } from "@/lib/ai/brief";
import { geminiConfigured } from "@/lib/ai/gemini";
import { getActiveAlerts } from "@/lib/alerts/run";
import { queryOne } from "@/lib/db";
import { IMPACT_ASSUMPTIONS } from "@/lib/engine/config";
import { formatINR, formatINRCompact, formatNumber, formatPctDelta, formatWeeks } from "@/lib/format";
import { longDate } from "@/lib/dates";
import { getImpact } from "@/lib/impact";
import { getMetricCards, getRegionalSales } from "@/lib/metrics/queries";
import { getPlannerData } from "@/lib/planner/queries";

export const metadata = { title: "Executive view · Freshroots Operations Hub" };

export default function ExecutivePage() {
  return (
    <>
      <PageTitle
        title="Operations intelligence"
        subtitle={
          <Suspense fallback={<Skeleton className="h-4 w-64" />}>
            <AsOfLine />
          </Suspense>
        }
        actions={
          <>
            <LiveRefresh />
            <RunEngineButton variant="secondary" />
          </>
        }
      />

      <div className="space-y-5">
        <Suspense fallback={<Skeleton className="h-16 w-full" />}>
          <AlertsSection />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <ImpactSection />
        </Suspense>

        <section aria-labelledby="metrics-h">
          <h2 id="metrics-h" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            Core operational metrics
          </h2>
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            }
          >
            <MetricsSection />
          </Suspense>
        </section>

        <div className="grid gap-5 xl:grid-cols-3">
          <Suspense fallback={<Skeleton className="h-80 xl:col-span-2" />}>
            <RegionSection />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-80" />}>
            <BriefSection />
          </Suspense>
        </div>

        <Suspense fallback={<SectionSkeleton rows={1} height="h-64" />}>
          <ExceptionsSection />
        </Suspense>
      </div>
    </>
  );
}

function stampLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

async function AsOfLine() {
  await connection();
  const run = await queryOne<{ as_of: string; festival: boolean; uplift: number }>(
    "select to_char(as_of, 'YYYY-MM-DD') as as_of, festival_active as festival, uplift::float8 as uplift from engine_runs order by id desc limit 1",
  );
  if (!run) {
    return <span>No data yet — run <code className="rounded bg-surface-2 px-1">npm run db:setup</code></span>;
  }
  return (
    <>
      <span>Stock as of {longDate(run.as_of)}</span>
      {run.festival && <Badge tone="accent">Festival month · +{Math.round(run.uplift * 100)}% demand uplift</Badge>}
    </>
  );
}

async function AlertsSection() {
  await connection();
  const alerts = await getActiveAlerts();
  return <AlertBanners alerts={alerts} />;
}

async function ImpactSection() {
  await connection();
  const impact = await getImpact();
  if (!impact.skuCount) return null;
  const { quarterlyBaselineLakh: base } = IMPACT_ASSUMPTIONS;
  const stockoutTotal = impact.stockoutExposure || 1;
  const unaddressed = Math.max(0, impact.stockoutExposure - impact.secured - impact.pending);
  const segs = [
    { label: "Secured by approved POs", value: impact.secured, color: "bg-ok" },
    { label: "Pending sign-off in drafts", value: impact.pending, color: "bg-accent" },
    { label: "Unaddressed", value: unaddressed, color: "bg-crit" },
  ];

  return (
    <Card>
      <div className="grid gap-0 lg:grid-cols-[minmax(280px,1fr)_2fr]">
        <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Net projected savings · this planning cycle</p>
          <p className="mt-2 text-[56px] font-semibold leading-none tracking-tight text-ok">{formatINRCompact(impact.netProjectedSavings)}</p>
          <dl className="mt-4 space-y-2 text-[13px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">Stockout margin protected</dt>
              <dd className="font-medium tabular-nums text-ink">{formatINR(impact.secured + impact.pending)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">Over-orders avoided (paused SKUs)</dt>
              <dd className="font-medium tabular-nums text-ink">{formatINR(impact.avoidedByPause)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
              <dt className="text-ink-2">Of which secured by approved POs</dt>
              <dd className="font-medium tabular-nums text-ink">{formatINR(impact.secured)}</dd>
            </div>
          </dl>
        </div>

        <div className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">Loss exposure on the shelf today</h2>
            <span className="text-xs text-ink-3">{impact.skuCount} SKUs · from your stock and sales data</span>
          </div>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] text-ink-2">Stockout margin at risk</p>
                <p className="text-lg font-semibold tabular-nums text-crit">{formatINR(impact.stockoutExposure)}</p>
              </div>
              <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Stockout exposure split into secured, pending sign-off and unaddressed">
                {segs.map((s) =>
                  s.value > 0 ? <span key={s.label} className={`${s.color} h-full`} style={{ width: `${(s.value / stockoutTotal) * 100}%` }} /> : null,
                )}
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
                {segs.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-sm ${s.color}`} aria-hidden />
                      {s.label}
                    </span>
                    <span className="tabular-nums">{formatINR(s.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] text-ink-2">Overstock write-off risk</p>
                <p className="text-lg font-semibold tabular-nums text-warn">{formatINR(impact.overstockExposure)}</p>
              </div>
              <p className="mt-2 text-xs text-ink-3">
                Stock above the 14-week cap (4-week window for perishables) × cost × write-off rate. Orders for these SKUs are paused until cover falls back inside the window.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
            <p>
              <span className="font-medium text-ink">Company baseline:</span> ₹{base.low}–{base.high} L lost per quarter to planning errors (₹18–22 L stockouts, ₹10–12 L overstock). The figures above are modelled only from the stock and sales in your data.
            </p>
            {(impact.pricingIsPlaceholder || impact.pricingMissing) && (
              <p className="flex items-start gap-1.5 text-warn">
                <span className="mt-0.5">
                  <ToneIcon tone="warn" size={13} />
                </span>
                {impact.pricingMissing ? "Some SKUs have no unit cost/price, so their ₹ impact shows as zero." : "₹ figures use placeholder unit costs and prices (data/seed/sku_pricing.csv) — load real Zoho rates for decision-grade numbers."}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

async function MetricsSection() {
  await connection();
  const cards = await getMetricCards();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <MetricCard key={c.def.name} card={c} />
      ))}
    </div>
  );
}

async function RegionSection() {
  await connection();
  const { rows, weeks, latestWeek } = await getRegionalSales();
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Orders by region"
        subtitle={latestWeek ? `Latest complete week starting ${longDate(latestWeek)} vs the average of the 4 weeks before it` : undefined}
        right={<Badge tone="info" title="Alerts fire when a region runs more than 15% below its 4-week pace">Alert at −15%</Badge>}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="px-4 py-2 font-medium">Region</th>
              <th className="px-2 py-2 font-medium">Distributors</th>
              <th className="px-2 py-2 text-right font-medium">Units</th>
              <th className="px-2 py-2 text-right font-medium">vs 4-wk pace</th>
              <th className="px-4 py-2 font-medium">12-week trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const drop = r.change != null && r.change <= -0.15;
              const surge = r.change != null && r.change >= 0.2;
              return (
                <tr key={r.region} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink">{r.region}</td>
                  <td className="px-2 py-2.5 text-ink-2">
                    {r.distributors.join(", ")} <span className="text-ink-3">· {r.skus} SKUs</span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatNumber(r.latest)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    <span className={drop ? "font-medium text-crit" : surge ? "font-medium text-accent" : "text-ink-2"}>{formatPctDelta(r.change)}</span>
                    {drop && (
                      <span className="ml-1.5 inline-block align-middle">
                        <Badge tone="crit" icon>
                          Drop
                        </Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Sparkline values={r.series} width={120} height={28} label={`${r.region} weekly units`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line">
        <RegionTrend weeks={weeks} series={rows.map((r) => ({ region: r.region, values: r.series.slice(-weeks.length) }))} />
      </div>
    </Card>
  );
}

async function BriefSection() {
  await connection();
  const brief = await getLatestBrief();
  return (
    <Card>
      <CardHeader
        title="Operations brief"
        subtitle={brief ? `${brief.source === "gemini" ? `Gemini · ${brief.model}` : "Rule-based summary"} · ${stampLabel(brief.createdAt)}` : "Not generated yet"}
        right={<RegenerateBriefButton />}
      />
      {brief ? (
        <div className="space-y-3 p-4 text-[13px]">
          <p className="text-[15px] font-semibold leading-snug text-ink">{brief.content.headline}</p>
          <p className="text-ink-2">{brief.content.summary}</p>
          <ul className="space-y-2">
            {brief.content.priorities.map((p) => (
              <li key={p.title} className="flex gap-2">
                <span className={`mt-0.5 shrink-0 ${p.severity === "critical" ? "text-crit" : p.severity === "warning" ? "text-warn" : "text-info"}`}>
                  <ToneIcon tone={p.severity === "critical" ? "crit" : p.severity === "warning" ? "warn" : "info"} size={14} />
                </span>
                <span>
                  <span className="font-medium text-ink">{p.title}</span>
                  <span className="block text-ink-2">{p.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {brief.content.watch_next.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Watch next</p>
              <ul className="list-disc space-y-0.5 pl-4 text-ink-2">
                {brief.content.watch_next.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.content.note && (
            <p className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-3">
              {brief.content.note}
              {!geminiConfigured() && " Set GEMINI_API_KEY in .env.local."}
            </p>
          )}
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-3">Run the planning engine to generate the first brief.</p>
      )}
    </Card>
  );
}

async function ExceptionsSection() {
  await connection();
  const { rows } = await getPlannerData();
  const exceptions = rows
    .filter((r) => r.action !== "hold" || r.flags.some((f) => f === "HIGH_DEMAND" || f === "STOCKOUT_RISK" || f === "OVERSTOCK_RISK"))
    .sort((a, b) => (a.cover ?? 99) - (b.cover ?? 99));

  return (
    <Card>
      <CardHeader
        title="Exceptions needing a decision"
        subtitle={`${exceptions.length} of ${rows.length} SKUs are outside their healthy range`}
        right={
          <Link href="/planner" className="text-[13px] font-medium text-accent hover:underline">
            Open planner view →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="text-xs text-ink-3">
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-2 py-2 text-right font-medium">Cover</th>
              <th className="px-2 py-2 font-medium">Signals</th>
              <th className="px-2 py-2 font-medium">Engine action</th>
              <th className="px-2 py-2 text-right font-medium">Draft PO</th>
              <th className="px-4 py-2 text-right font-medium">Est. value</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((r) => (
              <tr key={r.skuId} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <Link href={`/planner?sku=${r.skuId}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {r.name.replace(/^Freshroots /, "")}
                  </Link>
                  <span className="ml-2 text-xs text-ink-3">
                    {r.skuId}
                    {r.perishable ? " · perishable" : ""}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatWeeks(r.cover)}</td>
                <td className="px-2 py-2.5">
                  <FlagBadges flags={r.flags} hide={["SEASONAL_UPLIFT"]} />
                </td>
                <td className="px-2 py-2.5">
                  <ActionBadge action={r.action} />
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                  {r.po ? (
                    <>
                      {formatNumber(r.po.finalQty)}
                      <span className="ml-1.5 text-xs text-ink-3">{r.po.status}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{r.po?.estValue != null ? formatINR(r.po.estValue) : "—"}</td>
              </tr>
            ))}
            {exceptions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                  Every SKU is inside its healthy range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
