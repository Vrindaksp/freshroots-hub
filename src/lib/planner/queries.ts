import { getCommentaryForRun, type StoredCommentary } from "../ai/commentary";
import { query } from "../db";
import { DEFAULT_CONFIG, type EdgeReason, type Flag } from "../engine/config";
import { getLatestRunId } from "../engine/run";

export interface PlannerPo {
  id: number;
  status: "draft" | "approved" | "rejected";
  recommendedQty: number;
  finalQty: number;
  overrideReason: string | null;
  estValue: number | null;
  zohoStatus: string;
  decidedAt: string | null;
}

export interface PlannerRow {
  skuId: string;
  name: string;
  category: string;
  perishable: boolean;
  uom: string;
  distributor: string | null;
  region: string | null;
  standardOrderQty: number;
  unitCost: number | null;
  onHand: number;
  openPoUnits: number;
  avg4: number;
  avg12: number;
  trend: number;
  effective: number;
  cover: number | null;
  lowWeeks: number;
  highWeeks: number;
  flags: Flag[];
  isEdge: boolean;
  edgeReasons: EdgeReason[];
  action: "reorder" | "pause" | "hold";
  recommendedQty: number;
  rationale: string[];
  weekly: number[];
  po: PlannerPo | null;
  commentary: StoredCommentary | null;
}

export interface PlannerData {
  run: { id: number; asOf: string; festival: boolean; uplift: number; ranAt: string } | null;
  rows: PlannerRow[];
}

interface Raw {
  sku_id: string; name: string; category: string; perishable: boolean; uom: string; distributor: string | null; region: string | null;
  std: number; unit_cost: number | null; on_hand: number; open_po: number; avg4: number; avg12: number; trend: number; eff: number;
  cover: number | null; min_w: number; max_w: number; flags: Flag[]; edge: boolean; edge_reasons: EdgeReason[]; action: PlannerRow["action"];
  qty: number; rationale: string[]; weekly: number[];
  po_id: number | null; po_status: PlannerPo["status"] | null; po_rec: number | null; po_final: number | null; po_reason: string | null;
  po_value: number | null; po_zoho: string | null; po_decided: string | null;
}

export async function getPlannerData(): Promise<PlannerData> {
  const runId = await getLatestRunId();
  if (runId == null) return { run: null, rows: [] };

  const [runRows, raws, commentary] = await Promise.all([
    query<{ id: number; as_of: string; festival: boolean; uplift: number; ran_at: string }>(
      `select id::int as id, to_char(as_of, 'YYYY-MM-DD') as as_of, festival_active as festival, uplift::float8 as uplift,
              to_char(ran_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ran_at
       from engine_runs where id = $1`,
      [runId],
    ),
    query<Raw>(
      `select d.sku_id, s.name, s.category, s.perishability_flag as perishable, s.unit_of_measure as uom,
              dist.name as distributor, dist.region, s.standard_order_qty::int as std, s.unit_cost_inr::float8 as unit_cost,
              d.on_hand, d.open_po_units as open_po, d.avg_4w as avg4, d.avg_12w as avg12, coalesce(d.trend_pct, 0) as trend,
              d.effective_weekly_demand as eff, d.cover_weeks as cover,
              s.min_stock_weeks::float8 as min_w, s.max_stock_weeks::float8 as max_w,
              d.flags, d.is_edge_case as edge, d.edge_reasons, d.action, d.recommended_qty as qty, d.rationale, d.weekly_series as weekly,
              po.id::int as po_id, po.status as po_status, po.recommended_qty as po_rec, po.final_qty as po_final,
              po.override_reason as po_reason, po.est_value_inr::float8 as po_value, po.zoho_sync_status as po_zoho,
              to_char(po.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as po_decided
       from demand_signals d
       join skus s on s.id = d.sku_id
       join engine_runs e on e.id = d.run_id
       left join distributors dist on dist.id = s.distributor_id
       left join lateral (
         select p.* from purchase_orders p
         where p.sku_id = d.sku_id and (p.status = 'draft' or p.decided_at >= e.as_of)
         order by (p.status = 'draft') desc, p.id desc limit 1
       ) po on true
       where d.run_id = $1
       order by s.id`,
      [runId],
    ),
    getCommentaryForRun(runId),
  ]);

  const run = runRows[0];
  const rows: PlannerRow[] = raws.map((r) => ({
    skuId: r.sku_id,
    name: r.name,
    category: r.category,
    perishable: r.perishable,
    uom: r.uom,
    distributor: r.distributor,
    region: r.region,
    standardOrderQty: r.std,
    unitCost: r.unit_cost,
    onHand: r.on_hand,
    openPoUnits: r.open_po,
    avg4: r.avg4,
    avg12: r.avg12,
    trend: r.trend,
    effective: r.eff,
    cover: r.cover,
    lowWeeks: r.perishable ? r.min_w : DEFAULT_CONFIG.stockoutWeeks,
    highWeeks: r.perishable ? r.max_w : DEFAULT_CONFIG.overstockWeeks,
    flags: r.flags,
    isEdge: r.edge,
    edgeReasons: r.edge_reasons,
    action: r.action,
    recommendedQty: r.qty,
    rationale: r.rationale,
    weekly: r.weekly,
    po: r.po_id == null
      ? null
      : {
          id: r.po_id,
          status: r.po_status!,
          recommendedQty: r.po_rec!,
          finalQty: r.po_final!,
          overrideReason: r.po_reason,
          estValue: r.po_value,
          zohoStatus: r.po_zoho ?? "not_staged",
          decidedAt: r.po_decided,
        },
    commentary: commentary.get(r.sku_id) ?? null,
  }));

  return {
    run: { id: run.id, asOf: run.as_of, festival: run.festival, uplift: run.uplift, ranAt: run.ran_at },
    rows,
  };
}

export interface DecisionRow {
  id: number;
  skuId: string;
  name: string;
  status: "approved" | "rejected";
  recommendedQty: number;
  finalQty: number;
  overrideReason: string | null;
  estValue: number | null;
  zohoStatus: string;
  decidedAt: string;
}

export async function getRecentDecisions(limit = 8): Promise<DecisionRow[]> {
  const rows = await query<{
    id: number; sku_id: string; name: string; status: "approved" | "rejected"; rec: number; final: number; reason: string | null;
    value: number | null; zoho: string; decided: string;
  }>(
    `select p.id::int as id, p.sku_id, s.name, p.status, p.recommended_qty as rec, p.final_qty as final, p.override_reason as reason,
            (p.final_qty * s.unit_cost_inr)::float8 as value, p.zoho_sync_status as zoho,
            to_char(p.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as decided
     from purchase_orders p join skus s on s.id = p.sku_id
     where p.status in ('approved', 'rejected')
     order by p.decided_at desc, p.id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, skuId: r.sku_id, name: r.name, status: r.status, recommendedQty: r.rec, finalQty: r.final,
    overrideReason: r.reason, estValue: r.value, zohoStatus: r.zoho, decidedAt: r.decided,
  }));
}
