/**
 * The 12 core operational metrics.
 *
 * The brief names five (sales volume, fulfillment rate, stockout incidents, overstock value, distributor
 * complaints). The other seven are proposed here and are easy to swap: add/remove a row in METRICS.
 *
 * Provenance matters on an operations dashboard, so every reading carries a `source`:
 *   derived  – computed by this app from the ingested seed tables (sales, inventory, engine output)
 *   ingested – pushed through POST /api/ingest (the replacement for the Monday SAP→Excel export)
 *   sample   – illustrative series for metrics the seed data does not contain; replaced once a real feed arrives
 */

export type MetricUnit = "units" | "inr" | "pct" | "count" | "weeks";
export type MetricGrain = "week" | "snapshot";

export interface MetricDef {
  name: string;
  label: string;
  description: string;
  unit: MetricUnit;
  /** week = one point per complete ISO week; snapshot = point-in-time reading taken at the as-of date. */
  grain: MetricGrain;
  /** Which direction is an improvement. `neutral` metrics never turn red on movement alone. */
  better: "up" | "down" | "neutral";
  /** Where the data normally comes from. */
  origin: "derived" | "sample";
  /** Absolute thresholds that colour the card. */
  warnAbove?: number;
  critAbove?: number;
  warnBelow?: number;
  critBelow?: number;
  /** Week-over-week change (vs the mean of the previous 4 points) that raises an alert, as a ratio or points. */
  alertDrop?: { kind: "points" | "ratio"; warn: number; crit: number };
  alertRise?: { kind: "points" | "ratio"; warn: number; crit: number };
}

export const METRICS: MetricDef[] = [
  { name: "sales_volume", label: "Sales volume", description: "Units sold in the latest complete week", unit: "units", grain: "week", better: "up", origin: "derived" },
  { name: "sales_value", label: "Sales value", description: "Units × unit price (placeholder prices until Zoho rates are loaded)", unit: "inr", grain: "week", better: "up", origin: "derived" },
  { name: "order_fulfillment_rate", label: "Order fulfillment rate", description: "Share of ordered units shipped", unit: "pct", grain: "week", better: "up", origin: "sample", warnBelow: 95, critBelow: 90, alertDrop: { kind: "points", warn: 3, crit: 6 } },
  { name: "on_time_delivery_rate", label: "On-time delivery", description: "Deliveries on or before the promised date", unit: "pct", grain: "week", better: "up", origin: "sample", warnBelow: 92, critBelow: 85, alertDrop: { kind: "points", warn: 5, crit: 10 } },
  { name: "stockout_incidents", label: "Stockout incidents", description: "SKUs below their minimum cover (6 wk, or 3 wk for perishables)", unit: "count", grain: "snapshot", better: "down", origin: "derived", warnAbove: 1, critAbove: 4 },
  { name: "overstock_value", label: "Overstock value", description: "Cost of stock above the maximum cover cap", unit: "inr", grain: "snapshot", better: "down", origin: "derived", warnAbove: 1, critAbove: 100000 },
  { name: "write_off_value", label: "Write-off value", description: "Inventory written off in the week", unit: "inr", grain: "week", better: "down", origin: "sample", alertRise: { kind: "ratio", warn: 0.4, crit: 0.8 } },
  { name: "distributor_complaints", label: "Distributor complaints", description: "Complaints logged in the week", unit: "count", grain: "week", better: "down", origin: "sample", alertRise: { kind: "ratio", warn: 0.4, crit: 0.8 } },
  { name: "avg_weeks_of_cover", label: "Weeks of cover", description: "Total stock ÷ total weekly demand (festival-uplifted)", unit: "weeks", grain: "snapshot", better: "neutral", origin: "derived" },
  { name: "forecast_accuracy", label: "Forecast accuracy", description: "1 − WAPE of the 4-week-average forecast vs actual sales", unit: "pct", grain: "week", better: "up", origin: "derived", warnBelow: 90, critBelow: 80 },
  { name: "open_po_value", label: "Open PO value", description: "Draft + approved purchase orders awaiting receipt", unit: "inr", grain: "snapshot", better: "neutral", origin: "derived" },
  { name: "active_distributors", label: "Active distributors", description: "Distributors with sales in the week", unit: "count", grain: "week", better: "up", origin: "derived" },
];

export const METRIC_BY_NAME = new Map(METRICS.map((m) => [m.name, m]));

export const SOURCE_LABEL: Record<string, string> = {
  derived: "Live",
  ingested: "Feed",
  sample: "Sample",
};
