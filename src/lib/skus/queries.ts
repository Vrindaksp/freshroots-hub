import { query } from "../db";

export interface CatalogueSku {
  id: string;
  name: string;
  category: string;
  perishable: boolean;
  standardOrderQty: number;
  unitOfMeasure: string;
  distributorId: string | null;
  distributorName: string | null;
  unitCost: number | null;
  unitPrice: number | null;
  pricingSource: string | null;
  source: "seed" | "manual";
  zohoItemId: string | null;
  zohoSyncedAt: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  onHand: number;
  salesRows: number;
  decidedPos: number;
  /** True when the latest engine run already includes this SKU (a new SKU appears only after the next run). */
  inLatestRun: boolean;
  /** Permanent deletion is only safe when the SKU has no sales history and no approved/rejected POs. */
  canDelete: boolean;
}

export interface DistributorOption {
  id: string;
  name: string;
  region: string;
}

export async function getCatalogue(): Promise<{ skus: CatalogueSku[]; distributors: DistributorOption[]; categories: string[]; locations: string[] }> {
  const [rows, distributors, locations] = await Promise.all([
    query<{
      id: string; name: string; category: string; perishable: boolean; std: number; uom: string; distributor_id: string | null; distributor_name: string | null;
      cost: number | null; price: number | null; pricing_source: string | null; source: "seed" | "manual"; zoho_item_id: string | null;
      zoho_synced_at: string | null; archived_at: string | null; archived_reason: string | null; on_hand: number; sales_rows: number; decided_pos: number; in_run: boolean;
    }>(
      `select s.id, s.name, s.category, s.perishability_flag as perishable, s.standard_order_qty::int as std, s.unit_of_measure as uom,
              s.distributor_id, d.name as distributor_name, s.unit_cost_inr::float8 as cost, s.unit_price_inr::float8 as price,
              s.pricing_source, s.source, s.zoho_item_id,
              to_char(s.zoho_synced_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as zoho_synced_at,
              to_char(s.archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as archived_at, s.archived_reason,
              coalesce((select sum(i.current_stock_units) from inventory_levels i where i.sku_id = s.id), 0)::int as on_hand,
              (select count(*) from sales_history h where h.sku_id = s.id)::int as sales_rows,
              (select count(*) from purchase_orders p where p.sku_id = s.id and p.status <> 'draft')::int as decided_pos,
              exists (select 1 from demand_signals ds where ds.sku_id = s.id and ds.run_id = (select max(id) from engine_runs)) as in_run
       from skus s left join distributors d on d.id = s.distributor_id
       order by (s.archived_at is not null), s.id`,
    ),
    query<DistributorOption>("select id, name, region from distributors where active_status order by name"),
    query<{ location: string }>("select location from inventory_levels group by location order by count(*) desc, location"),
  ]);

  const skus: CatalogueSku[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    perishable: r.perishable,
    standardOrderQty: r.std,
    unitOfMeasure: r.uom,
    distributorId: r.distributor_id,
    distributorName: r.distributor_name,
    unitCost: r.cost,
    unitPrice: r.price,
    pricingSource: r.pricing_source,
    source: r.source,
    zohoItemId: r.zoho_item_id,
    zohoSyncedAt: r.zoho_synced_at,
    archivedAt: r.archived_at,
    archivedReason: r.archived_reason,
    onHand: r.on_hand,
    salesRows: r.sales_rows,
    decidedPos: r.decided_pos,
    inLatestRun: r.in_run,
    canDelete: r.sales_rows === 0 && r.decided_pos === 0,
  }));

  return {
    skus,
    distributors,
    categories: [...new Set(skus.map((s) => s.category))].sort(),
    locations: locations.map((l) => l.location),
  };
}
