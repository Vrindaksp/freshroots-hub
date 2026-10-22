import { jsonParam, query } from "../db";
import { mondayOf } from "../dates";
import { getAsOfDate } from "../engine/data";
import { getLatestRunId } from "../engine/run";
import { METRICS } from "../metrics/registry";
import {
  detectInventoryAlerts,
  detectMetricDeviation,
  detectRegionalDeviations,
  elapsedFraction,
  type AlertCandidate,
  type RegionalInput,
  type Severity,
} from "./detect";

/**
 * Runs every anomaly check and reconciles the alerts table:
 *   - new/continuing conditions are upserted (an acknowledgement survives re-checks within the same week)
 *   - conditions that no longer hold are auto-resolved
 */
export async function runAlertChecks(asOfOverride?: string): Promise<{ active: number; resolved: number }> {
  const asOf = asOfOverride ?? (await getAsOfDate());
  const weekStart = mondayOf(asOf);
  const candidates: AlertCandidate[] = [];

  // 1. Regional order pace (works on partial weeks when a daily feed lands in sales_history).
  const regional = await query<{ region: string; wk: string; units: number; last_date: string; ndates: number }>(
    `select d.region, to_char(date_trunc('week', s.date)::date, 'YYYY-MM-DD') as wk,
            sum(s.quantity_sold)::int as units,
            to_char(max(s.date), 'YYYY-MM-DD') as last_date,
            count(distinct s.date)::int as ndates
     from sales_history s join distributors d on d.id = s.distributor_id
     where s.date >= $1::date - 49
     group by 1, 2
     order by 1, 2`,
    [weekStart],
  );
  const byRegion = new Map<string, typeof regional>();
  for (const r of regional) {
    if (!byRegion.has(r.region)) byRegion.set(r.region, []);
    byRegion.get(r.region)!.push(r);
  }
  const regionalInputs: RegionalInput[] = [];
  for (const [region, rows] of byRegion) {
    const latest = rows[rows.length - 1];
    // A week dated only on its Monday is a weekly-grain feed and therefore complete.
    const inProgress = latest.wk === weekStart && (latest.ndates > 1 || latest.last_date !== latest.wk);
    regionalInputs.push({
      region,
      series: rows.map((r) => ({ week: r.wk, units: r.units })),
      elapsed: inProgress ? elapsedFraction(latest.wk, latest.last_date) : 1,
      lastDate: latest.last_date,
    });
  }
  candidates.push(...detectRegionalDeviations(regionalInputs));

  // 2. Fulfillment, delivery, complaints, write-offs.
  for (const def of METRICS.filter((m) => m.alertDrop || m.alertRise)) {
    const series = await query<{ at: string; value: number; source: string }>(
      `select to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD') as at, value::float8 as value, source
       from operational_metrics
       where metric_name = $1 and region is null
       order by recorded_at desc limit 8`,
      [def.name],
    );
    series.reverse();
    const source = series[series.length - 1]?.source ?? "derived";
    candidates.push(...detectMetricDeviation(def, series, source === "sample" ? "sample data" : source));
  }

  // 3. Inventory exceptions from the latest engine run.
  const runId = await getLatestRunId();
  if (runId != null) {
    const signals = await query<{
      sku_id: string;
      name: string;
      perishable: boolean;
      flags: string[];
      cover: number | null;
      min_weeks: number;
      max_weeks: number;
      trend: number;
      action: string;
      qty: number;
    }>(
      `select d.sku_id, s.name, s.perishability_flag as perishable, d.flags, d.cover_weeks as cover,
              s.min_stock_weeks::float8 as min_weeks, s.max_stock_weeks::float8 as max_weeks,
              d.trend_pct as trend, d.action, d.recommended_qty as qty
       from demand_signals d join skus s on s.id = d.sku_id
       where d.run_id = $1`,
      [runId],
    );
    candidates.push(
      ...detectInventoryAlerts(
        signals.map((s) => ({
          skuId: s.sku_id,
          name: s.name.replace(/^Freshroots /, ""),
          perishable: s.perishable,
          flags: s.flags,
          coverWeeks: s.cover,
          lowWeeks: s.perishable ? s.min_weeks : 6,
          highWeeks: s.perishable ? s.max_weeks : 14,
          trend: s.trend ?? 0,
          action: s.action,
          recommendedQty: s.qty,
        })),
        asOf,
      ),
    );
  }

  if (candidates.length) {
    await query(
      `insert into alerts (dedupe_key, type, severity, region, sku_id, metric_name, title, message, details)
       select dedupe_key, type, severity, region, sku_id, metric_name, title, message, details
       from json_to_recordset($1::json) as t(
         dedupe_key text, type text, severity text, region text, sku_id text, metric_name text,
         title text, message text, details jsonb)
       on conflict (dedupe_key) do update set
         severity = excluded.severity, title = excluded.title, message = excluded.message,
         details = excluded.details, resolved_at = null`,
      [
        jsonParam(
          candidates.map((c) => ({
            dedupe_key: c.dedupeKey,
            type: c.type,
            severity: c.severity,
            region: c.region ?? null,
            sku_id: c.skuId ?? null,
            metric_name: c.metricName ?? null,
            title: c.title,
            message: c.message,
            details: c.details,
          })),
        ),
      ],
    );
  }

  const resolved = await query<{ id: number }>(
    `update alerts set resolved_at = now()
     where resolved_at is null
       and dedupe_key not in (select k from json_array_elements_text($1::json) as k)
     returning id::int as id`,
    [jsonParam(candidates.map((c) => c.dedupeKey))],
  );
  return { active: candidates.length, resolved: resolved.length };
}

export interface AlertRow {
  id: number;
  type: string;
  severity: Severity;
  region: string | null;
  skuId: string | null;
  title: string;
  message: string;
  acknowledged: boolean;
}

export async function getActiveAlerts(): Promise<AlertRow[]> {
  const rows = await query<{
    id: number;
    type: string;
    severity: Severity;
    region: string | null;
    sku_id: string | null;
    title: string;
    message: string;
    acknowledged: boolean;
  }>(
    `select id::int as id, type, severity, region, sku_id, title, message, acknowledged_at is not null as acknowledged
     from alerts
     where resolved_at is null
     order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, detected_at desc, id`,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    region: r.region,
    skuId: r.sku_id,
    title: r.title,
    message: r.message,
    acknowledged: r.acknowledged,
  }));
}
