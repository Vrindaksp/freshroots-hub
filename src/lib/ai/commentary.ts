import { query, queryOne } from "../db";
import { EDGE_LABELS, type EdgeReason } from "../engine/config";
import { ANALYST_SYSTEM, generateStructured, geminiConfigured } from "./gemini";

export type Recommendation =
  | "accept_rule_quantity"
  | "increase_quantity"
  | "reduce_quantity"
  | "hold_order"
  | "investigate_first";

export interface EdgeCommentary {
  headline: string;
  assessment: string;
  likely_drivers: string[];
  recommendation: Recommendation;
  suggested_qty: number | null;
  confidence: "low" | "medium" | "high";
  questions_for_planner: string[];
  note?: string;
}

export interface StoredCommentary {
  content: EdgeCommentary;
  model: string;
  source: "gemini" | "rules";
  createdAt: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence, under 20 words, naming the issue." },
    assessment: { type: "string", description: "2-4 sentences: what the data shows and whether the rule output looks right." },
    likely_drivers: { type: "array", items: { type: "string" }, description: "Up to 3 data-grounded explanations." },
    recommendation: {
      type: "string",
      enum: ["accept_rule_quantity", "increase_quantity", "reduce_quantity", "hold_order", "investigate_first"],
    },
    suggested_qty: { type: ["integer", "null"], description: "Suggested order quantity, or null to keep the rule quantity." },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    questions_for_planner: { type: "array", items: { type: "string" }, description: "Up to 3 concrete things to verify before signing off." },
  },
  required: ["headline", "assessment", "likely_drivers", "recommendation", "suggested_qty", "confidence", "questions_for_planner"],
};

interface Context {
  skuId: string;
  name: string;
  category: string;
  perishable: boolean;
  standardOrderQty: number;
  asOf: string;
  festival: boolean;
  uplift: number;
  distributor: string | null;
  region: string | null;
  onHand: number;
  openPoUnits: number;
  avg4: number;
  avg12: number;
  trend: number;
  effective: number;
  cover: number | null;
  flags: string[];
  edgeReasons: EdgeReason[];
  action: string;
  recommendedQty: number;
  rationale: string[];
  weekly: number[];
  siblings: { sku: string; trend: number }[];
}

async function loadContext(runId: number, skuId: string): Promise<Context | undefined> {
  const row = await queryOne<{
    sku_id: string; name: string; category: string; perishable: boolean; std: number; as_of: string; festival: boolean; uplift: number;
    distributor: string | null; region: string | null; distributor_id: string | null; on_hand: number; open_po: number; avg4: number; avg12: number;
    trend: number; eff: number; cover: number | null; flags: string[]; edge: EdgeReason[]; action: string; qty: number; rationale: string[]; weekly: number[];
  }>(
    `select d.sku_id, s.name, s.category, s.perishability_flag as perishable, s.standard_order_qty::int as std,
            to_char(e.as_of, 'YYYY-MM-DD') as as_of, e.festival_active as festival, e.uplift::float8 as uplift,
            dist.name as distributor, dist.region, s.distributor_id,
            d.on_hand, d.open_po_units as open_po, d.avg_4w as avg4, d.avg_12w as avg12, d.trend_pct as trend,
            d.effective_weekly_demand as eff, d.cover_weeks as cover, d.flags, d.edge_reasons as edge,
            d.action, d.recommended_qty as qty, d.rationale, d.weekly_series as weekly
     from demand_signals d
     join skus s on s.id = d.sku_id
     join engine_runs e on e.id = d.run_id
     left join distributors dist on dist.id = s.distributor_id
     where d.run_id = $1 and d.sku_id = $2`,
    [runId, skuId],
  );
  if (!row) return undefined;

  const siblings = row.distributor_id
    ? await query<{ sku: string; trend: number }>(
        `select s.name as sku, d.trend_pct as trend
         from demand_signals d join skus s on s.id = d.sku_id
         where d.run_id = $1 and s.distributor_id = $2 and d.sku_id <> $3
         order by s.id`,
        [runId, row.distributor_id, skuId],
      )
    : [];

  return {
    skuId: row.sku_id, name: row.name, category: row.category, perishable: row.perishable, standardOrderQty: row.std,
    asOf: row.as_of, festival: row.festival, uplift: row.uplift, distributor: row.distributor, region: row.region,
    onHand: row.on_hand, openPoUnits: row.open_po, avg4: row.avg4, avg12: row.avg12, trend: row.trend, effective: row.eff,
    cover: row.cover, flags: row.flags, edgeReasons: row.edge, action: row.action, recommendedQty: row.qty,
    rationale: row.rationale, weekly: row.weekly, siblings,
  };
}

function buildPrompt(c: Context): string {
  const facts = {
    sku: { id: c.skuId, name: c.name, category: c.category, high_perishability: c.perishable, standard_order_qty: c.standardOrderQty },
    distributor: { name: c.distributor, region: c.region, other_skus_trend_4w_vs_12w: c.siblings.map((s) => ({ sku: s.sku, trend_pct: +(s.trend * 100).toFixed(1) })) },
    calendar: { as_of: c.asOf, festival_month: c.festival, demand_uplift_applied: c.uplift },
    stock: { on_hand: c.onHand, open_purchase_order_units: c.openPoUnits, weeks_of_cover_after_uplift: c.cover == null ? null : +c.cover.toFixed(2) },
    demand: {
      avg_weekly_4w: +c.avg4.toFixed(1),
      avg_weekly_12w: +c.avg12.toFixed(1),
      trend_4w_vs_12w_pct: +(c.trend * 100).toFixed(1),
      effective_weekly_demand_after_uplift: +c.effective.toFixed(1),
      weekly_units_oldest_to_newest: c.weekly.slice(-16),
    },
    rule_engine: { action: c.action, recommended_qty: c.recommendedQty, flags: c.flags, reasoning: c.rationale },
    why_flagged_for_review: c.edgeReasons.map((r) => EDGE_LABELS[r]),
  };
  return `A rule engine produced the recommendation below, and this SKU was routed to you because rules are least reliable for it. Review it for the demand planner (Raghav), who will sign off the purchase order.

Rules in force: reorder below 6 weeks of cover (3 weeks for high-perishability SKUs), pause above 14 weeks (4 weeks for perishables), +25% demand uplift in festival months (Oct, Nov, Mar) applied before thresholds, reorder at 1.5x standard quantity when the 4-week average exceeds the 12-week average by more than 20%.

Decide whether the rule quantity should be accepted, adjusted or investigated first. If you adjust, give suggested_qty and justify it from the data. Do not suggest quantities that push stock plus open orders beyond the maximum cover for the SKU's window.

DATA (JSON):
${JSON.stringify(facts, null, 2)}`;
}

/** Deterministic fallback so the review panel is never empty (no key, outage, quota). */
export function rulesCommentary(c: Context, note?: string): EdgeCommentary {
  const reasons = c.edgeReasons;
  const trendPct = (c.trend * 100).toFixed(1);
  const drivers: string[] = [];
  if (reasons.includes("DEMAND_SHIFT")) {
    drivers.push(`Sales stepped from ~${c.avg12.toFixed(0)} to ~${c.avg4.toFixed(0)} units/week (${trendPct}%).`);
    const rising = c.siblings.filter((s) => s.trend > 0.05).length;
    drivers.push(
      rising === 0
        ? `No other ${c.distributor ?? "distributor"} SKU moved with it, so this looks SKU-specific (promotion, listing or a bulk buyer) rather than a distributor-wide shift.`
        : `${rising} other ${c.distributor ?? "distributor"} SKU(s) are also rising, which points to a broader distributor-level change.`,
    );
  }
  if (reasons.includes("SIGNAL_CONFLICT")) {
    drivers.push(`Rules say "${c.action}" while demand is trending ${trendPct}%, so cover may be tighter than the window implies.`);
  }
  if (reasons.includes("DEEP_SHORTFALL")) {
    drivers.push(`Stock is ${c.cover?.toFixed(1) ?? "—"} weeks of cover, so the order spans ${(c.recommendedQty / c.standardOrderQty).toFixed(1)} standard lots.`);
  }
  if (reasons.includes("NEW_LAUNCH")) drivers.push("Fewer than 8 weeks of history; averages are unreliable.");
  if (reasons.includes("VOLATILE")) drivers.push("Weekly sales swing widely, so the 12-week average may mislead.");

  const rec: Recommendation =
    reasons.includes("SIGNAL_CONFLICT") || reasons.includes("NEW_LAUNCH") ? "investigate_first" : "accept_rule_quantity";
  return {
    headline: reasons.length ? `${EDGE_LABELS[reasons[0]]}: review before sign-off` : "Review before sign-off",
    assessment: `The rules say "${c.action}"${c.recommendedQty ? ` (${c.recommendedQty.toLocaleString("en-IN")} units)` : ""} at ${c.cover == null ? "—" : c.cover.toFixed(1)} weeks of cover with demand ${c.trend >= 0 ? "up" : "down"} ${Math.abs(c.trend * 100).toFixed(1)}%. Flagged for review because: ${reasons.map((r) => EDGE_LABELS[r].toLowerCase()).join("; ")}.`,
    likely_drivers: drivers.slice(0, 3),
    recommendation: rec,
    suggested_qty: null,
    confidence: "low",
    questions_for_planner: [
      "Is there a promotion, new listing or one-off bulk order behind the recent sales?",
      "Can the supplier deliver inside the cover window shown?",
    ],
    note: note ?? "Rule-based draft. Add GEMINI_API_KEY for context-aware commentary.",
  };
}

async function store(runId: number, skuId: string, content: EdgeCommentary, model: string, source: "gemini" | "rules") {
  await query(
    `insert into ai_outputs (kind, sku_id, run_id, content, model, source) values ('edge_case', $1, $2, $3::jsonb, $4, $5)`,
    [skuId, runId, JSON.stringify(content), model, source],
  );
}

export async function generateSkuCommentary(runId: number, skuId: string): Promise<StoredCommentary | undefined> {
  const ctx = await loadContext(runId, skuId);
  if (!ctx) return undefined;

  let content: EdgeCommentary;
  let model = "rules";
  let source: "gemini" | "rules" = "rules";
  if (geminiConfigured()) {
    try {
      const result = await generateStructured<EdgeCommentary>({ system: ANALYST_SYSTEM, prompt: buildPrompt(ctx), schema: SCHEMA });
      content = result.data;
      model = result.model;
      source = "gemini";
    } catch (err) {
      content = rulesCommentary(ctx, `Gemini unavailable (${err instanceof Error ? err.message.slice(0, 140) : "error"}); showing rule-based draft.`);
    }
  } else {
    content = rulesCommentary(ctx);
  }
  await store(runId, skuId, content, model, source);
  return { content, model, source, createdAt: new Date().toISOString() };
}

/**
 * A re-run on the same as-of date with an unchanged recommendation reuses the earlier Gemini answer
 * instead of paying for the same analysis twice.
 */
async function reusePriorCommentary(runId: number): Promise<void> {
  await query(
    `insert into ai_outputs (kind, sku_id, run_id, content, model, source)
     select 'edge_case', cur.sku_id, cur.run_id, prior.content, prior.model, prior.source
     from demand_signals cur
     join engine_runs cr on cr.id = cur.run_id
     join lateral (
       select o.content, o.model, o.source
       from ai_outputs o
       join demand_signals ds on ds.run_id = o.run_id and ds.sku_id = o.sku_id
       join engine_runs er on er.id = o.run_id
       where o.kind = 'edge_case' and o.source = 'gemini' and o.sku_id = cur.sku_id and o.run_id <> cur.run_id
         and er.as_of = cr.as_of and ds.action = cur.action and ds.recommended_qty = cur.recommended_qty and ds.on_hand = cur.on_hand
       order by o.id desc limit 1
     ) prior on true
     where cur.run_id = $1 and cur.is_edge_case
       and not exists (select 1 from ai_outputs x where x.kind = 'edge_case' and x.run_id = cur.run_id and x.sku_id = cur.sku_id)`,
    [runId],
  );
}

/** Generates commentary for every edge case in a run that does not already have Gemini commentary. */
export async function generateEdgeCommentary(runId: number, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force) await reusePriorCommentary(runId);
  const edge = await query<{ sku_id: string; source: string | null }>(
    `select d.sku_id,
            (select o.source from ai_outputs o where o.kind = 'edge_case' and o.run_id = d.run_id and o.sku_id = d.sku_id order by o.id desc limit 1) as source
     from demand_signals d
     where d.run_id = $1 and d.is_edge_case`,
    [runId],
  );
  const live = geminiConfigured();
  const todo = edge.filter((e) => opts.force || e.source == null || (e.source === "rules" && live));
  // Small fan-out keeps within Gemini rate limits for the 15–20% of SKUs that are edge cases.
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map((e) => generateSkuCommentary(runId, e.sku_id)));
  }
  return todo.length;
}

export async function getCommentaryForRun(runId: number): Promise<Map<string, StoredCommentary>> {
  const rows = await query<{ sku_id: string; content: EdgeCommentary; model: string; source: "gemini" | "rules"; created_at: string }>(
    `select distinct on (sku_id) sku_id, content, model, source,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
     from ai_outputs
     where kind = 'edge_case' and run_id = $1
     order by sku_id, id desc`,
    [runId],
  );
  return new Map(rows.map((r) => [r.sku_id, { content: r.content, model: r.model, source: r.source, createdAt: r.created_at }]));
}
