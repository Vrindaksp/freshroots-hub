import { runAlertChecks } from "@/lib/alerts/run";
import { hasValidBearer } from "@/lib/auth";
import { jsonParam, query } from "@/lib/db";
import { refreshIntelligence } from "@/lib/intelligence";
import { getKillSwitch } from "@/lib/killswitch";
import { METRIC_BY_NAME } from "@/lib/metrics/registry";
import { upsertMetrics, type MetricRow } from "@/lib/metrics/snapshot";

export const maxDuration = 60;

const MAX_ROWS = 5000;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Push endpoint that replaces the Monday SAP → Excel export. Authenticate with `Authorization: Bearer $INGEST_TOKEN`.
 *
 * Body (every key optional):
 *   {
 *     "metrics":   [{ "metric_name": "order_fulfillment_rate", "recorded_at": "2026-10-19T00:00:00Z", "value": 96.1, "region": null }],
 *     "sales":     [{ "sku_id": "SKU001", "date": "2026-10-20", "quantity_sold": 31, "distributor_id": "DIST001", "channel": null }],
 *     "inventory": [{ "sku_id": "SKU001", "location": "Pune Central Warehouse", "current_stock_units": 870, "as_of_date": "2026-10-20" }]
 *   }
 *
 * Daily sales rows make the regional-pace alert work mid-week. Add `?refresh=1` to re-run the planning engine afterwards.
 */
export async function POST(request: Request) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return Response.json({ error: "Ingest is disabled: set INGEST_TOKEN" }, { status: 503 });
  if (!hasValidBearer(request, token)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { metrics?: unknown[]; sales?: unknown[]; inventory?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const errors: string[] = [];
  const counts = { metrics: 0, sales: 0, inventory: 0 };

  const metrics: MetricRow[] = [];
  for (const [i, m] of (body.metrics ?? []).slice(0, MAX_ROWS).entries()) {
    const r = m as Record<string, unknown>;
    if (typeof r.metric_name !== "string" || !METRIC_BY_NAME.has(r.metric_name)) errors.push(`metrics[${i}]: unknown metric_name`);
    else if (typeof r.value !== "number" || !Number.isFinite(r.value)) errors.push(`metrics[${i}]: value must be a number`);
    else if (typeof r.recorded_at !== "string" || Number.isNaN(Date.parse(r.recorded_at))) errors.push(`metrics[${i}]: recorded_at must be an ISO timestamp`);
    else {
      metrics.push({
        recorded_at: r.recorded_at,
        metric_name: r.metric_name,
        value: r.value,
        region: typeof r.region === "string" ? r.region : null,
        source: "ingested",
      });
    }
  }

  const sales: Record<string, unknown>[] = [];
  for (const [i, s] of (body.sales ?? []).slice(0, MAX_ROWS).entries()) {
    const r = s as Record<string, unknown>;
    if (typeof r.sku_id !== "string" || !isDate(r.date) || !Number.isInteger(r.quantity_sold) || (r.quantity_sold as number) < 0) {
      errors.push(`sales[${i}]: need sku_id, date (YYYY-MM-DD) and integer quantity_sold >= 0`);
    } else {
      sales.push({
        sku_id: r.sku_id,
        date: r.date,
        quantity_sold: r.quantity_sold,
        distributor_id: typeof r.distributor_id === "string" ? r.distributor_id : null,
        channel: typeof r.channel === "string" ? r.channel : null,
      });
    }
  }

  const inventory: Record<string, unknown>[] = [];
  for (const [i, s] of (body.inventory ?? []).slice(0, MAX_ROWS).entries()) {
    const r = s as Record<string, unknown>;
    if (typeof r.sku_id !== "string" || !isDate(r.as_of_date) || !Number.isInteger(r.current_stock_units) || (r.current_stock_units as number) < 0) {
      errors.push(`inventory[${i}]: need sku_id, as_of_date (YYYY-MM-DD) and integer current_stock_units >= 0`);
    } else {
      inventory.push({
        sku_id: r.sku_id,
        location: typeof r.location === "string" ? r.location : "Main",
        current_stock_units: r.current_stock_units,
        as_of_date: r.as_of_date,
      });
    }
  }
  if (errors.length) return Response.json({ error: "Validation failed", details: errors.slice(0, 20) }, { status: 422 });

  try {
    if (metrics.length) {
      await upsertMetrics(metrics);
      counts.metrics = metrics.length;
    }
    if (sales.length) {
      // Unspecified distributors fall back to the SKU's primary distributor, as the seed load does.
      await query(
        `insert into sales_history (distributor_id, sku_id, date, quantity_sold, channel)
         select coalesce(t.distributor_id, k.distributor_id), t.sku_id, t.date, t.quantity_sold, t.channel
         from json_to_recordset($1::json) as t(distributor_id text, sku_id text, date date, quantity_sold int, channel text)
         join skus k on k.id = t.sku_id
         on conflict (sku_id, date, coalesce(distributor_id, ''), coalesce(channel, ''))
         do update set quantity_sold = excluded.quantity_sold`,
        [jsonParam(sales)],
      );
      counts.sales = sales.length;
    }
    if (inventory.length) {
      await query(
        `insert into inventory_levels (sku_id, location, current_stock_units, as_of_date)
         select t.sku_id, t.location, t.current_stock_units, t.as_of_date
         from json_to_recordset($1::json) as t(sku_id text, location text, current_stock_units int, as_of_date date)
         join skus k on k.id = t.sku_id
         on conflict (sku_id, location) do update
           set current_stock_units = excluded.current_stock_units, as_of_date = excluded.as_of_date`,
        [jsonParam(inventory)],
      );
      counts.inventory = inventory.length;
    }

    // Data is always stored; only the engine refresh is automation, so the kill switch skips just that part.
    const refreshRequested = new URL(request.url).searchParams.get("refresh") === "1";
    const paused = refreshRequested && (await getKillSwitch()).paused;
    const result = refreshRequested && !paused ? await refreshIntelligence({ commentary: false, brief: false }) : undefined;
    const alerts = result ? result.alerts : await runAlertChecks();
    return Response.json({
      ingested: counts,
      alerts,
      engineRunId: result?.run.runId ?? null,
      engine: !refreshRequested ? "not_requested" : paused ? "skipped_automation_paused" : "ran",
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Ingest failed" }, { status: 500 });
  }
}
