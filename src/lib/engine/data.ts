import { query, queryOne } from "../db";
import { addDays, mondayOf, yearMonthOf } from "../dates";
import { DEFAULT_CONFIG, type EngineConfig } from "./config";
import type { SkuInput } from "./rules";

export interface SkuMeta {
  skuId: string;
  name: string;
  category: string;
  perishable: boolean;
  uom: string;
  distributorId: string | null;
  distributorName: string | null;
  region: string | null;
  unitCost: number | null;
  unitPrice: number | null;
  pricingSource: string | null;
  standardOrderQty: number;
}

export interface EngineInputs {
  asOf: string;
  /** Monday of the as-of week; the lookback windows end the day before. */
  weekStart: string;
  /** Last complete week (Monday) included in the rolling windows. */
  lastCompleteWeek: string;
  festival: boolean;
  uplift: number;
  inputs: SkuInput[];
  meta: Map<string, SkuMeta>;
  /** Week labels (Mondays) matching each SKU's series tail, for display. */
  weeks: string[];
}

/**
 * The as-of date is data-driven: the stock snapshot date. The app never trusts the server clock for
 * planning, so a stale demo database still produces internally consistent numbers.
 */
export async function getAsOfDate(): Promise<string> {
  const inv = await queryOne<{ d: string | null }>(
    "select to_char(max(as_of_date), 'YYYY-MM-DD') as d from inventory_levels",
  );
  if (inv?.d) return inv.d;
  const sales = await queryOne<{ d: string | null }>("select to_char(max(date), 'YYYY-MM-DD') as d from sales_history");
  if (sales?.d) return addDays(mondayOf(sales.d), 7);
  return new Date().toISOString().slice(0, 10);
}

export async function getUplift(asOf: string, config: EngineConfig = DEFAULT_CONFIG): Promise<{ festival: boolean; uplift: number }> {
  const row = await queryOne<{ festival: boolean; uplift: number }>(
    "select is_festival_month as festival, demand_uplift::float8 as uplift from calendar where year_month = $1",
    [yearMonthOf(asOf)],
  );
  if (row) return { festival: row.festival, uplift: row.festival ? row.uplift || config.festivalUplift : 0 };
  const month = Number(asOf.slice(5, 7));
  const festival = config.festivalMonths.includes(month);
  return { festival, uplift: festival ? config.festivalUplift : 0 };
}

/** 12-week rolling average of complete weeks, written back to inventory_levels.average_weekly_sales. */
export async function refreshAverageWeeklySales(): Promise<void> {
  await query(
    `update inventory_levels i
     set average_weekly_sales = coalesce((
       select round(sum(s.quantity_sold)::numeric / greatest(1, count(distinct date_trunc('week', s.date))), 2)
       from sales_history s
       where s.sku_id = i.sku_id
         and s.date <  date_trunc('week', i.as_of_date)::date
         and s.date >= date_trunc('week', i.as_of_date)::date - 84
     ), 0)`,
  );
}

interface SkuRow {
  id: string;
  name: string;
  category: string;
  perishable: boolean;
  min_weeks: number;
  max_weeks: number;
  std: number;
  unit_cost: number | null;
  unit_price: number | null;
  pricing_source: string | null;
  uom: string;
  distributor_id: string | null;
  distributor_name: string | null;
  region: string | null;
  on_hand: number;
  ext_open_po: number;
}

export async function loadEngineInputs(asOf: string, config: EngineConfig = DEFAULT_CONFIG): Promise<EngineInputs> {
  const weekStart = mondayOf(asOf);
  const lastCompleteWeek = addDays(weekStart, -7);
  const { festival, uplift } = await getUplift(asOf, config);

  const [skuRows, approvedRows, salesRows] = await Promise.all([
    query<SkuRow>(
      `select s.id, s.name, s.category,
              s.perishability_flag as perishable,
              s.min_stock_weeks::float8 as min_weeks, s.max_stock_weeks::float8 as max_weeks,
              s.standard_order_qty::int as std,
              s.unit_cost_inr::float8 as unit_cost, s.unit_price_inr::float8 as unit_price,
              s.pricing_source, s.unit_of_measure as uom,
              s.distributor_id, d.name as distributor_name, d.region,
              coalesce(sum(i.current_stock_units), 0)::int as on_hand,
              coalesce(sum(i.open_purchase_orders), 0)::int as ext_open_po
       from skus s
       left join distributors d on d.id = s.distributor_id
       left join inventory_levels i on i.sku_id = s.id
       where s.archived_at is null
       group by s.id, d.id
       order by s.id`,
    ),
    // Approved in this system after the stock snapshot → not yet reflected in on-hand.
    query<{ sku_id: string; qty: number }>(
      `select sku_id, sum(final_qty)::int as qty
       from purchase_orders
       where status = 'approved' and decided_at >= $1::date
       group by sku_id`,
      [asOf],
    ),
    query<{ sku_id: string; wk: string; units: number }>(
      `select sku_id, to_char(date_trunc('week', date)::date, 'YYYY-MM-DD') as wk, sum(quantity_sold)::int as units
       from sales_history
       where date < $1::date and date >= $1::date - 182
       group by 1, 2
       order by 1, 2`,
      [weekStart],
    ),
  ]);

  const approved = new Map(approvedRows.map((r) => [r.sku_id, r.qty]));
  const byWeek = new Map<string, Map<string, number>>();
  for (const r of salesRows) {
    if (!byWeek.has(r.sku_id)) byWeek.set(r.sku_id, new Map());
    byWeek.get(r.sku_id)!.set(r.wk, r.units);
  }

  const inputs: SkuInput[] = [];
  const meta = new Map<string, SkuMeta>();
  let longestSeries: string[] = [];

  for (const s of skuRows) {
    const weeksMap = byWeek.get(s.id) ?? new Map<string, number>();
    const sorted = [...weeksMap.keys()].sort();
    const series: number[] = [];
    const labels: string[] = [];
    if (sorted.length) {
      for (let w = sorted[0]; w <= lastCompleteWeek; w = addDays(w, 7)) {
        series.push(weeksMap.get(w) ?? 0);
        labels.push(w);
      }
    }
    if (labels.length > longestSeries.length) longestSeries = labels;

    inputs.push({
      skuId: s.id,
      name: s.name,
      perishable: s.perishable,
      minStockWeeks: s.min_weeks,
      maxStockWeeks: s.max_weeks,
      standardOrderQty: s.std,
      unitCost: s.unit_cost,
      onHand: s.on_hand,
      openPoUnits: s.ext_open_po + (approved.get(s.id) ?? 0),
      weekly: series,
      uplift,
    });
    meta.set(s.id, {
      skuId: s.id,
      name: s.name,
      category: s.category,
      perishable: s.perishable,
      uom: s.uom,
      distributorId: s.distributor_id,
      distributorName: s.distributor_name,
      region: s.region,
      unitCost: s.unit_cost,
      unitPrice: s.unit_price,
      pricingSource: s.pricing_source,
      standardOrderQty: s.std,
    });
  }

  return { asOf, weekStart, lastCompleteWeek, festival, uplift, inputs, meta, weeks: longestSeries };
}
