import { query } from "../db";
import { METRICS, type MetricDef } from "./registry";

export type CardStatus = "ok" | "warn" | "crit" | "neutral" | "empty";

export interface MetricCard {
  def: MetricDef;
  value: number | null;
  previous: number | null;
  /** Fractional change vs the previous reading (null when there is no previous reading). */
  change: number | null;
  /** Percentage-point change for pct metrics. */
  changePoints: number | null;
  series: number[];
  latestAt: string | null;
  source: "derived" | "ingested" | "sample" | null;
  status: CardStatus;
}

interface Reading {
  metric_name: string;
  at: string;
  value: number;
  source: "derived" | "ingested" | "sample";
}

export function statusFor(def: MetricDef, value: number, change: number | null, changePoints: number | null): CardStatus {
  if (def.critAbove != null && value > def.critAbove) return "crit";
  if (def.critBelow != null && value < def.critBelow) return "crit";
  if (def.warnAbove != null && value >= def.warnAbove) return "warn";
  if (def.warnBelow != null && value < def.warnBelow) return "warn";
  if (def.better === "neutral") return "neutral";
  // Otherwise colour by the size of an adverse move.
  const adverse = def.better === "up" ? -1 : 1;
  if (def.unit === "pct" && changePoints != null) {
    const bad = changePoints * adverse;
    return bad >= 5 ? "crit" : bad >= 2 ? "warn" : "ok";
  }
  if (change != null) {
    const bad = change * adverse;
    return bad >= 0.4 ? "crit" : bad >= 0.2 ? "warn" : "ok";
  }
  return "ok";
}

export async function getMetricCards(pointsPerSeries = 16): Promise<MetricCard[]> {
  const rows = await query<Reading>(
    `select metric_name, to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD') as at, value::float8 as value, source
     from operational_metrics
     where region is null
     order by metric_name, recorded_at`,
  );
  const grouped = new Map<string, Reading[]>();
  for (const r of rows) {
    if (!grouped.has(r.metric_name)) grouped.set(r.metric_name, []);
    grouped.get(r.metric_name)!.push(r);
  }

  return METRICS.map((def) => {
    const readings = (grouped.get(def.name) ?? []).slice(-pointsPerSeries);
    if (!readings.length) {
      return { def, value: null, previous: null, change: null, changePoints: null, series: [], latestAt: null, source: null, status: "empty" as const };
    }
    const latest = readings[readings.length - 1];
    const prev = readings.length > 1 ? readings[readings.length - 2] : null;
    const change = prev && prev.value !== 0 ? latest.value / prev.value - 1 : null;
    const changePoints = prev ? latest.value - prev.value : null;
    return {
      def,
      value: latest.value,
      previous: prev?.value ?? null,
      change,
      changePoints,
      series: readings.map((r) => r.value),
      latestAt: latest.at,
      source: latest.source,
      status: statusFor(def, latest.value, change, changePoints),
    };
  });
}

export interface RegionRow {
  region: string;
  latest: number;
  baseline: number;
  change: number | null;
  series: number[];
  skus: number;
  distributors: string[];
}

/** Weekly unit sales by region: latest complete week vs the mean of the 4 weeks before it. */
export async function getRegionalSales(): Promise<{ rows: RegionRow[]; latestWeek: string | null; weeks: string[] }> {
  const data = await query<{ region: string; wk: string; units: number }>(
    `select region, to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD') as wk, value::float8 as units
     from operational_metrics
     where metric_name = 'sales_volume' and region is not null
     order by region, recorded_at`,
  );
  const meta = await query<{ region: string; skus: number; distributors: string[] }>(
    `select d.region, count(distinct s.id)::int as skus, array_agg(distinct d.name order by d.name) as distributors
     from distributors d left join skus s on s.distributor_id = d.id and s.archived_at is null
     group by d.region`,
  );
  const metaBy = new Map(meta.map((m) => [m.region, m]));

  const byRegion = new Map<string, { wk: string; units: number }[]>();
  for (const r of data) {
    if (!byRegion.has(r.region)) byRegion.set(r.region, []);
    byRegion.get(r.region)!.push({ wk: r.wk, units: r.units });
  }
  const allWeeks = [...new Set(data.map((d) => d.wk))].sort();

  const rows: RegionRow[] = [...byRegion.entries()].map(([region, pts]) => {
    const latest = pts[pts.length - 1]?.units ?? 0;
    const prior = pts.slice(-5, -1).map((p) => p.units);
    const baseline = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
    return {
      region,
      latest,
      baseline,
      change: baseline > 0 ? latest / baseline - 1 : null,
      series: pts.slice(-12).map((p) => p.units),
      skus: metaBy.get(region)?.skus ?? 0,
      distributors: metaBy.get(region)?.distributors ?? [],
    };
  });
  rows.sort((a, b) => b.latest - a.latest);
  return { rows, latestWeek: allWeeks[allWeeks.length - 1] ?? null, weeks: allWeeks.slice(-12) };
}
