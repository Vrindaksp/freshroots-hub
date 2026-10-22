import { jsonParam, query, queryOne } from "../db";
import { DEFAULT_CONFIG, type EngineConfig } from "./config";
import { getAsOfDate, loadEngineInputs, refreshAverageWeeklySales } from "./data";
import { evaluateSku, type SkuEvaluation } from "./rules";

export interface EngineRunResult {
  runId: number;
  asOf: string;
  festival: boolean;
  uplift: number;
  evaluated: number;
  reorder: number;
  pause: number;
  hold: number;
  edgeCases: number;
  draftPos: number;
  draftValue: number;
  evaluations: SkuEvaluation[];
}

/**
 * Runs the rule engine for every SKU and persists:
 *   - demand_signals: one auditable row per SKU per run (averages, flags, rationale)
 *   - purchase_orders: draft POs, upserted so Raghav's overrides on an open draft survive a re-run
 */
export async function runEngine(opts: { asOf?: string; config?: EngineConfig } = {}): Promise<EngineRunResult> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const asOf = opts.asOf ?? (await getAsOfDate());
  await refreshAverageWeeklySales();
  const data = await loadEngineInputs(asOf, config);

  const evaluations = data.inputs.map((input) => evaluateSku(input, config));
  const inputBySku = new Map(data.inputs.map((i) => [i.skuId, i]));

  const counts = {
    reorder: evaluations.filter((e) => e.action === "reorder").length,
    pause: evaluations.filter((e) => e.action === "pause").length,
    hold: evaluations.filter((e) => e.action === "hold").length,
    edgeCases: evaluations.filter((e) => e.isEdgeCase).length,
  };
  const orders = evaluations.filter((e) => e.action === "reorder" && e.recommendedQty > 0);
  const draftValue = orders.reduce((sum, e) => sum + (e.estValue ?? 0), 0);

  const run = (await queryOne<{ id: number }>(
    `insert into engine_runs (as_of, festival_active, uplift, summary)
     values ($1::date, $2, $3, $4::jsonb) returning id::int as id`,
    [
      asOf,
      data.festival,
      data.uplift,
      JSON.stringify({ ...counts, evaluated: evaluations.length, draftPos: orders.length, draftValue }),
    ],
  ))!;

  await query(
    `insert into demand_signals
       (run_id, sku_id, avg_4w, avg_12w, trend_pct, effective_weekly_demand, on_hand, open_po_units, cover_weeks,
        flags, is_edge_case, edge_reasons, action, recommended_qty, rationale, weekly_series)
     select $2::bigint, sku_id, avg_4w, avg_12w, trend_pct, effective_weekly_demand, on_hand, open_po_units, cover_weeks,
            flags, is_edge_case, edge_reasons, action, recommended_qty, rationale, weekly_series
     from json_to_recordset($1::json) as t(
       sku_id text, avg_4w float8, avg_12w float8, trend_pct float8, effective_weekly_demand float8,
       on_hand int, open_po_units int, cover_weeks float8, flags jsonb, is_edge_case boolean, edge_reasons jsonb,
       action text, recommended_qty int, rationale jsonb, weekly_series jsonb)`,
    [
      jsonParam(
        evaluations.map((e) => {
          const input = inputBySku.get(e.skuId)!;
          return {
            sku_id: e.skuId,
            avg_4w: e.avg4,
            avg_12w: e.avg12,
            trend_pct: e.trend,
            effective_weekly_demand: e.effectiveWeeklyDemand,
            on_hand: input.onHand,
            open_po_units: input.openPoUnits,
            cover_weeks: e.coverWeeks,
            flags: e.flags,
            is_edge_case: e.isEdgeCase,
            edge_reasons: e.edgeReasons,
            action: e.action,
            recommended_qty: e.recommendedQty,
            rationale: e.rationale,
            weekly_series: input.weekly,
          };
        }),
      ),
      run.id,
    ],
  );

  // Draft POs. A draft the planner already overrode keeps its final_qty and reason.
  const poRows = orders.map((e) => ({
    sku_id: e.skuId,
    qty: e.recommendedQty,
    flags: e.flags,
    rationale: e.rationale.join(" "),
    est_value: e.estValue,
  }));
  if (poRows.length) {
    await query(
      `insert into purchase_orders (sku_id, recommended_qty, final_qty, rule_flags, rationale, est_value_inr, run_id)
       select sku_id, qty, qty, flags, rationale, est_value, $2::bigint
       from json_to_recordset($1::json) as t(sku_id text, qty int, flags jsonb, rationale text, est_value numeric)
       on conflict (sku_id) where status = 'draft' do update set
         recommended_qty = excluded.recommended_qty,
         final_qty = case when purchase_orders.override_reason is not null then purchase_orders.final_qty else excluded.final_qty end,
         rule_flags = excluded.rule_flags,
         rationale = excluded.rationale,
         est_value_inr = excluded.est_value_inr,
         run_id = excluded.run_id`,
      [jsonParam(poRows), run.id],
    );
  }
  await query(
    `delete from purchase_orders
     where status = 'draft'
       and sku_id not in (select sku_id from json_to_recordset($1::json) as t(sku_id text))`,
    [jsonParam(poRows.map((r) => ({ sku_id: r.sku_id })))],
  );

  return {
    runId: run.id,
    asOf,
    festival: data.festival,
    uplift: data.uplift,
    evaluated: evaluations.length,
    ...counts,
    draftPos: orders.length,
    draftValue,
    evaluations,
  };
}

export async function getLatestRunId(): Promise<number | null> {
  const row = await queryOne<{ id: number }>("select id::int as id from engine_runs order by id desc limit 1");
  return row?.id ?? null;
}
