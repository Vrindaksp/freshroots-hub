import { query } from "./db";
import { DEFAULT_CONFIG, IMPACT_ASSUMPTIONS } from "./engine/config";
import { getLatestRunId } from "./engine/run";

/**
 * Rupee impact of the current planning cycle. This is a MODEL, not accounting:
 *
 *   Stockout exposure   = units short of the minimum cover × gross margin per unit × stockoutRealisation
 *   Overstock exposure  = units above the maximum cover × unit cost × write-off rate (perishable vs not)
 *
 *   Secured             = stockout exposure removed by APPROVED purchase orders
 *   Pending in drafts   = stockout exposure that DRAFT purchase orders would remove if approved
 *   Avoided by pausing  = the extra excess one standard lot would add above the cap × unit cost × write-off rate,
 *                         for each SKU whose orders are paused (i.e. the over-order the pause prevents)
 *
 * Net projected savings = secured + pending + avoided. Every constant lives in IMPACT_ASSUMPTIONS.
 */

export interface ImpactSku {
  skuId: string;
  name: string;
  stockoutExposure: number;
  overstockExposure: number;
  secured: number;
  pending: number;
  avoidedByPause: number;
}

export interface ImpactSummary {
  asOf: string | null;
  skuCount: number;
  stockoutExposure: number;
  overstockExposure: number;
  totalExposure: number;
  secured: number;
  pending: number;
  avoidedByPause: number;
  netProjectedSavings: number;
  pricingIsPlaceholder: boolean;
  pricingMissing: boolean;
  perSku: ImpactSku[];
}

interface Row {
  sku_id: string;
  name: string;
  as_of: string;
  on_hand: number;
  eff: number;
  flags: string[];
  perishable: boolean;
  min_w: number;
  max_w: number;
  std: number;
  cost: number | null;
  price: number | null;
  pricing_source: string | null;
  approved_qty: number;
  draft_qty: number;
}

export async function getImpact(): Promise<ImpactSummary> {
  const runId = await getLatestRunId();
  const empty: ImpactSummary = {
    asOf: null, skuCount: 0, stockoutExposure: 0, overstockExposure: 0, totalExposure: 0, secured: 0, pending: 0,
    avoidedByPause: 0, netProjectedSavings: 0, pricingIsPlaceholder: false, pricingMissing: false, perSku: [],
  };
  if (runId == null) return empty;

  const rows = await query<Row>(
    `select d.sku_id, s.name, to_char(e.as_of, 'YYYY-MM-DD') as as_of, d.on_hand, d.effective_weekly_demand as eff, d.flags,
            s.perishability_flag as perishable, s.min_stock_weeks::float8 as min_w, s.max_stock_weeks::float8 as max_w,
            s.standard_order_qty::int as std, s.unit_cost_inr::float8 as cost, s.unit_price_inr::float8 as price, s.pricing_source,
            coalesce((select sum(p.final_qty) from purchase_orders p
                      where p.sku_id = d.sku_id and p.status = 'approved' and p.decided_at >= e.as_of), 0)::int as approved_qty,
            coalesce((select sum(p.final_qty) from purchase_orders p
                      where p.sku_id = d.sku_id and p.status = 'draft'), 0)::int as draft_qty
     from demand_signals d
     join skus s on s.id = d.sku_id
     join engine_runs e on e.id = d.run_id
     where d.run_id = $1`,
    [runId],
  );

  const a = IMPACT_ASSUMPTIONS;
  const perSku: ImpactSku[] = rows.map((r) => {
    const margin = r.cost != null && r.price != null ? Math.max(0, r.price - r.cost) : 0;
    const cost = r.cost ?? 0;
    const lowUnits = (r.perishable ? r.min_w : DEFAULT_CONFIG.stockoutWeeks) * r.eff;
    const highUnits = (r.perishable ? r.max_w : DEFAULT_CONFIG.overstockWeeks) * r.eff;
    const writeOffRate = r.perishable ? a.overstockWriteOffPerishable : a.overstockWriteOffNonPerishable;
    const perUnitLoss = margin * a.stockoutRealisation;

    let stockoutExposure = 0;
    let secured = 0;
    let pending = 0;
    if (r.flags.includes("STOCKOUT_RISK")) {
      const before = Math.max(0, lowUnits - r.on_hand);
      const afterApproved = Math.max(0, lowUnits - r.on_hand - r.approved_qty);
      stockoutExposure = before * perUnitLoss;
      secured = (before - afterApproved) * perUnitLoss;
      pending = Math.min(afterApproved, r.draft_qty) * perUnitLoss;
    }

    let overstockExposure = 0;
    let avoidedByPause = 0;
    if (r.flags.includes("OVERSTOCK_RISK")) {
      overstockExposure = Math.max(0, r.on_hand - highUnits) * cost * writeOffRate;
      const excessNow = Math.max(0, r.on_hand - highUnits);
      const excessAfterLot = Math.max(0, r.on_hand + r.std - highUnits);
      avoidedByPause = (excessAfterLot - excessNow) * cost * writeOffRate;
    }
    return { skuId: r.sku_id, name: r.name, stockoutExposure, overstockExposure, secured, pending, avoidedByPause };
  });

  const sum = (f: (s: ImpactSku) => number) => perSku.reduce((acc, s) => acc + f(s), 0);
  const stockoutExposure = sum((s) => s.stockoutExposure);
  const overstockExposure = sum((s) => s.overstockExposure);
  const secured = sum((s) => s.secured);
  const pending = sum((s) => s.pending);
  const avoidedByPause = sum((s) => s.avoidedByPause);

  return {
    asOf: rows[0]?.as_of ?? null,
    skuCount: rows.length,
    stockoutExposure,
    overstockExposure,
    totalExposure: stockoutExposure + overstockExposure,
    secured,
    pending,
    avoidedByPause,
    netProjectedSavings: secured + pending + avoidedByPause,
    pricingIsPlaceholder: rows.some((r) => r.pricing_source === "placeholder"),
    pricingMissing: rows.some((r) => r.cost == null || r.price == null),
    perSku,
  };
}
