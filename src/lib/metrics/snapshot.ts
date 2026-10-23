import { jsonParam, query } from "../db";
import { addDays, mondayOf } from "../dates";
import { DEFAULT_CONFIG } from "../engine/config";
import { getAsOfDate } from "../engine/data";
import { getLatestRunId } from "../engine/run";

export interface MetricRow {
  recorded_at: string;
  metric_name: string;
  value: number;
  region?: string | null;
  source: "derived" | "ingested" | "sample";
}

export async function upsertMetrics(rows: MetricRow[]): Promise<void> {
  if (!rows.length) return;
  // Chunk so one request stays comfortably inside Neon's HTTP payload limits.
  for (let i = 0; i < rows.length; i += 2000) {
    await query(
      `insert into operational_metrics (recorded_at, metric_name, value, region, source)
       select recorded_at, metric_name, value, region, source
       from json_to_recordset($1::json) as t(recorded_at timestamptz, metric_name text, value float8, region text, source text)
       on conflict (metric_name, recorded_at, coalesce(region, ''))
       do update set value = excluded.value, source = excluded.source`,
      [jsonParam(rows.slice(i, i + 2000))],
    );
  }
}

const stamp = (date: string) => `${date}T00:00:00Z`;

/**
 * Weekly metrics derived from sales history. Only COMPLETE weeks are written, so a half-finished week
 * never shows up as a collapse in a dashboard card (mid-week deviations are the alert engine's job).
 */
export async function refreshWeeklyMetrics(asOf?: string): Promise<number> {
  const today = asOf ?? (await getAsOfDate());
  const weekStart = mondayOf(today);

  const rows = await query<{
    sku_id: string;
    wk: string;
    units: number;
    distributor_id: string | null;
    region: string | null;
    price: number | null;
  }>(
    `select s.sku_id, to_char(date_trunc('week', s.date)::date, 'YYYY-MM-DD') as wk,
            sum(s.quantity_sold)::int as units,
            s.distributor_id, d.region, k.unit_price_inr::float8 as price
     from sales_history s
     join skus k on k.id = s.sku_id
     left join distributors d on d.id = s.distributor_id
     where s.date < $1::date
     group by s.sku_id, 2, s.distributor_id, d.region, k.unit_price_inr`,
    [weekStart],
  );
  if (!rows.length) return 0;

  const weeks = [...new Set(rows.map((r) => r.wk))].sort();
  const bySkuWeek = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!bySkuWeek.has(r.sku_id)) bySkuWeek.set(r.sku_id, new Map());
    const m = bySkuWeek.get(r.sku_id)!;
    m.set(r.wk, (m.get(r.wk) ?? 0) + r.units);
  }

  const out: MetricRow[] = [];
  for (const wk of weeks) {
    const inWeek = rows.filter((r) => r.wk === wk);
    const units = inWeek.reduce((a, r) => a + r.units, 0);
    const value = inWeek.reduce((a, r) => a + r.units * (r.price ?? 0), 0);
    const distributors = new Set(inWeek.filter((r) => r.units > 0 && r.distributor_id).map((r) => r.distributor_id));
    out.push({ recorded_at: stamp(wk), metric_name: "sales_volume", value: units, source: "derived" });
    out.push({ recorded_at: stamp(wk), metric_name: "sales_value", value, source: "derived" });
    out.push({ recorded_at: stamp(wk), metric_name: "active_distributors", value: distributors.size, source: "derived" });

    const byRegion = new Map<string, number>();
    for (const r of inWeek) if (r.region) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + r.units);
    for (const [region, v] of byRegion) {
      out.push({ recorded_at: stamp(wk), metric_name: "sales_volume", value: v, region, source: "derived" });
    }

    // Forecast accuracy: how well would a plain trailing 4-week average have predicted this week?
    let absErr = 0;
    let actual = 0;
    for (const [, series] of bySkuWeek) {
      const prev = [1, 2, 3, 4].map((k) => series.get(addDays(wk, -7 * k)));
      if (prev.some((p) => p == null)) continue;
      const forecast = (prev as number[]).reduce((a, b) => a + b, 0) / 4;
      const a = series.get(wk) ?? 0;
      absErr += Math.abs(a - forecast);
      actual += a;
    }
    if (actual > 0) {
      out.push({ recorded_at: stamp(wk), metric_name: "forecast_accuracy", value: Math.max(0, (1 - absErr / actual) * 100), source: "derived" });
    }
  }
  await upsertMetrics(out);
  return out.length;
}

/**
 * Point-in-time metrics read from the latest engine run and the PO staging table.
 * Called after every engine run and every PO decision so the dashboard reflects sign-offs immediately.
 */
export async function refreshStateMetrics(asOf?: string): Promise<void> {
  const runId = await getLatestRunId();
  if (runId == null) return;
  const date = asOf ?? (await getAsOfDate());

  const signals = await query<{
    sku_id: string;
    on_hand: number;
    eff: number;
    flags: string[];
    perishable: boolean;
    max_weeks: number;
    unit_cost: number | null;
  }>(
    `select d.sku_id, d.on_hand, d.effective_weekly_demand as eff, d.flags,
            s.perishability_flag as perishable, s.max_stock_weeks::float8 as max_weeks, s.unit_cost_inr::float8 as unit_cost
     from demand_signals d join skus s on s.id = d.sku_id
     where d.run_id = $1 and s.archived_at is null`,
    [runId],
  );

  const stockouts = signals.filter((s) => s.flags.includes("STOCKOUT_RISK")).length;
  let overstockValue = 0;
  for (const s of signals) {
    if (!s.flags.includes("OVERSTOCK_RISK")) continue;
    const weeks = s.perishable ? s.max_weeks : DEFAULT_CONFIG.overstockWeeks;
    overstockValue += Math.max(0, s.on_hand - weeks * s.eff) * (s.unit_cost ?? 0);
  }
  const totalDemand = signals.reduce((a, s) => a + s.eff, 0);
  const totalStock = signals.reduce((a, s) => a + s.on_hand, 0);

  const po = await query<{ value: number }>(
    `select coalesce(sum(p.final_qty * coalesce(s.unit_cost_inr, 0)), 0)::float8 as value
     from purchase_orders p join skus s on s.id = p.sku_id
     where p.status = 'draft' or (p.status = 'approved' and p.decided_at >= $1::date)`,
    [date],
  );

  await upsertMetrics([
    { recorded_at: stamp(date), metric_name: "stockout_incidents", value: stockouts, source: "derived" },
    { recorded_at: stamp(date), metric_name: "overstock_value", value: overstockValue, source: "derived" },
    { recorded_at: stamp(date), metric_name: "avg_weeks_of_cover", value: totalDemand > 0 ? totalStock / totalDemand : 0, source: "derived" },
    { recorded_at: stamp(date), metric_name: "open_po_value", value: po[0]?.value ?? 0, source: "derived" },
  ]);
}

/** Illustrative weekly series for metrics the seed data cannot provide. Deterministic, clearly labelled `sample`. */
export async function seedSampleOperationalMetrics(weeks: string[]): Promise<number> {
  let state = 20260419;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const jitter = (spread: number) => (rand() - 0.5) * 2 * spread;

  const rows: MetricRow[] = [];
  weeks.forEach((wk, i) => {
    const t = i / Math.max(1, weeks.length - 1);
    rows.push({ recorded_at: stamp(wk), metric_name: "order_fulfillment_rate", value: +(96.2 + jitter(1.1) - t * 0.4).toFixed(1), source: "sample" });
    rows.push({ recorded_at: stamp(wk), metric_name: "on_time_delivery_rate", value: +(93.6 + jitter(1.6)).toFixed(1), source: "sample" });
    rows.push({ recorded_at: stamp(wk), metric_name: "distributor_complaints", value: Math.max(1, Math.round(9 + jitter(1.4))), source: "sample" });
    rows.push({ recorded_at: stamp(wk), metric_name: "write_off_value", value: Math.round(16000 + jitter(2200)), source: "sample" });
  });
  await upsertMetrics(rows);
  return rows.length;
}
