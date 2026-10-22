import { parseDate } from "../dates";
import type { MetricDef } from "../metrics/registry";

export type Severity = "info" | "warning" | "critical";

export interface AlertCandidate {
  dedupeKey: string;
  type: string;
  severity: Severity;
  region?: string;
  skuId?: string;
  metricName?: string;
  title: string;
  message: string;
  details: Record<string, unknown>;
}

export const REGIONAL_DROP_THRESHOLD = 0.15;
export const REGIONAL_DROP_CRITICAL = 0.25;
export const REGIONAL_SURGE_THRESHOLD = 0.2;

/** Share of a week's orders that normally land on each weekday (Mon → Sun). */
const WEEKDAY_WEIGHTS = [1.15, 1.1, 1.05, 1.0, 1.1, 0.9, 0.3];
const WEIGHT_TOTAL = WEEKDAY_WEIGHTS.reduce((a, b) => a + b, 0);

/** Fraction of the week's normal order volume expected by the end of `lastDate`. */
export function elapsedFraction(weekStart: string, lastDate: string): number {
  const days = Math.round((parseDate(lastDate).getTime() - parseDate(weekStart).getTime()) / 86_400_000);
  if (days < 0) return 0;
  if (days >= 6) return 1;
  return WEEKDAY_WEIGHTS.slice(0, days + 1).reduce((a, b) => a + b, 0) / WEIGHT_TOTAL;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface RegionalInput {
  region: string;
  /** Ascending weekly totals; the last entry may be a partial week. */
  series: { week: string; units: number }[];
  /** Share of the latest week that has elapsed (1 for a complete week). */
  elapsed: number;
  /** Last day with data in the latest week, for the message. */
  lastDate: string;
}

/**
 * Compares the latest (possibly partial) week against the pace of the previous four weeks.
 * A region running more than 15% under that pace is flagged — this is what catches a mid-week order drop
 * days before the weekly report would.
 */
export function detectRegionalDeviations(inputs: RegionalInput[]): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const r of inputs) {
    if (r.series.length < 3) continue;
    const latest = r.series[r.series.length - 1];
    const baseline = mean(r.series.slice(-5, -1).map((p) => p.units));
    const expected = baseline * r.elapsed;
    if (expected <= 0) continue;
    const deviation = latest.units / expected - 1;
    const partial = r.elapsed < 1;
    const through = WEEKDAY_NAMES[(parseDate(r.lastDate).getUTCDay() + 6) % 7];
    const details = {
      week: latest.week,
      actual: latest.units,
      expected: Math.round(expected),
      baselineWeekly: Math.round(baseline),
      deviation,
      partialWeek: partial,
      throughDate: r.lastDate,
    };

    if (deviation <= -REGIONAL_DROP_THRESHOLD) {
      out.push({
        dedupeKey: `REGIONAL_DROP:${r.region}:${latest.week}`,
        type: "REGIONAL_DROP",
        severity: deviation <= -REGIONAL_DROP_CRITICAL ? "critical" : "warning",
        region: r.region,
        metricName: "sales_volume",
        title: `${r.region}: orders ${Math.abs(deviation * 100).toFixed(0)}% below pace`,
        message: `${r.region} has booked ${latest.units.toLocaleString("en-IN")} units${partial ? ` through ${through}` : " this week"} against ~${Math.round(expected).toLocaleString("en-IN")} expected from the previous 4 weeks.`,
        details,
      });
    } else if (deviation >= REGIONAL_SURGE_THRESHOLD) {
      out.push({
        dedupeKey: `REGIONAL_SURGE:${r.region}:${latest.week}`,
        type: "REGIONAL_SURGE",
        severity: "info",
        region: r.region,
        metricName: "sales_volume",
        title: `${r.region}: orders ${(deviation * 100).toFixed(0)}% above pace`,
        message: `${r.region} has booked ${latest.units.toLocaleString("en-IN")} units${partial ? ` through ${through}` : " this week"} against ~${Math.round(expected).toLocaleString("en-IN")} expected. Check stock for the SKUs behind it.`,
        details,
      });
    }
  }
  return out;
}

/** Week-over-week deviation in fulfillment, delivery, complaints and write-offs against the previous-4-week mean. */
export function detectMetricDeviation(
  def: MetricDef,
  series: { at: string; value: number }[],
  source: string,
): AlertCandidate[] {
  if (series.length < 4) return [];
  const latest = series[series.length - 1];
  const baseline = mean(series.slice(-5, -1).map((p) => p.value));
  if (baseline === 0) return [];
  const out: AlertCandidate[] = [];

  const measure = (rule: NonNullable<MetricDef["alertDrop"]>, sign: 1 | -1) => {
    const delta = rule.kind === "points" ? (latest.value - baseline) * sign : (latest.value / baseline - 1) * sign;
    if (delta < rule.warn) return;
    const severity: Severity = delta >= rule.crit ? "critical" : "warning";
    const pretty = rule.kind === "points" ? `${delta.toFixed(1)} pts` : `${(delta * 100).toFixed(0)}%`;
    out.push({
      dedupeKey: `METRIC_DEVIATION:${def.name}:${latest.at}`,
      type: "METRIC_DEVIATION",
      severity,
      metricName: def.name,
      title: `${def.label} ${sign === 1 ? "up" : "down"} ${pretty} vs 4-week average`,
      message: `${def.label} is ${latest.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} against a 4-week average of ${baseline.toLocaleString("en-IN", { maximumFractionDigits: 1 })}. Source: ${source}.`,
      details: { latest: latest.value, baseline, at: latest.at, source },
    });
  };
  // `better` decides which direction is adverse; sign flips the delta so a positive result always means "worse".
  if (def.alertDrop) measure(def.alertDrop, -1);
  if (def.alertRise) measure(def.alertRise, 1);
  return out;
}

export interface SignalInput {
  skuId: string;
  name: string;
  perishable: boolean;
  flags: string[];
  coverWeeks: number | null;
  lowWeeks: number;
  highWeeks: number;
  trend: number;
  action: string;
  recommendedQty: number;
}

export function detectInventoryAlerts(signals: SignalInput[], asOf: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const s of signals) {
    const cover = s.coverWeeks != null ? s.coverWeeks.toFixed(1) : "—";
    if (s.flags.includes("STOCKOUT_RISK")) {
      const severe = s.perishable || (s.coverWeeks != null && s.coverWeeks < s.lowWeeks / 2);
      out.push({
        dedupeKey: `STOCKOUT_RISK:${s.skuId}:${asOf}`,
        type: "STOCKOUT_RISK",
        severity: severe ? "critical" : "warning",
        skuId: s.skuId,
        title: `${s.name}: ${cover} wk cover`,
        message: `${s.perishable ? "Perishable window minimum" : "Reorder threshold"} is ${s.lowWeeks} weeks. ${s.recommendedQty > 0 ? `Draft PO for ${s.recommendedQty.toLocaleString("en-IN")} units awaits sign-off.` : "No draft PO (covered or capped)."}`,
        details: { cover: s.coverWeeks, threshold: s.lowWeeks, perishable: s.perishable },
      });
    }
    if (s.flags.includes("OVERSTOCK_RISK")) {
      out.push({
        dedupeKey: `OVERSTOCK_RISK:${s.skuId}:${asOf}`,
        type: "OVERSTOCK_RISK",
        severity: s.perishable ? "warning" : "info",
        skuId: s.skuId,
        title: `${s.name}: ${cover} wk cover, orders paused`,
        message: `Cover exceeds the ${s.highWeeks}-week ${s.perishable ? "perishable window" : "pause threshold"}. Write-off risk rises until it sells through.`,
        details: { cover: s.coverWeeks, threshold: s.highWeeks, perishable: s.perishable },
      });
    }
    if (s.flags.includes("HIGH_DEMAND")) {
      out.push({
        dedupeKey: `HIGH_DEMAND:${s.skuId}:${asOf}`,
        type: "HIGH_DEMAND",
        severity: "info",
        skuId: s.skuId,
        title: `${s.name}: demand +${(s.trend * 100).toFixed(0)}% vs 12-week average`,
        message: "4-week sales exceed the 12-week average by more than 20%; reorder sized at 1.5× standard quantity.",
        details: { trend: s.trend },
      });
    }
  }
  return out;
}
