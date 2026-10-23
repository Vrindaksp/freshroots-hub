import { query, queryOne } from "../db";
import { getActiveAlerts } from "../alerts/run";
import { getLatestRunId } from "../engine/run";
import { getImpact } from "../impact";
import { formatINRCompact } from "../format";
import { getMetricCards } from "../metrics/queries";
import { ANALYST_SYSTEM, generateStructured, geminiConfigured } from "./gemini";

export interface OpsBrief {
  headline: string;
  summary: string;
  priorities: { title: string; detail: string; severity: "info" | "warning" | "critical" }[];
  watch_next: string[];
  note?: string;
}

export interface StoredBrief {
  content: OpsBrief;
  model: string;
  source: "gemini" | "rules";
  createdAt: string;
  runId: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence, under 22 words, for an executive." },
    summary: { type: "string", description: "2-3 sentences on operational health and the money at stake." },
    priorities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
        required: ["title", "detail", "severity"],
      },
    },
    watch_next: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "summary", "priorities", "watch_next"],
};

async function gather() {
  const runId = await getLatestRunId();
  const [cards, alerts, impact, run, signals, drafts] = await Promise.all([
    getMetricCards(),
    getActiveAlerts(),
    getImpact(),
    runId == null
      ? undefined
      : queryOne<{ as_of: string; festival: boolean; uplift: number }>(
          "select to_char(as_of, 'YYYY-MM-DD') as as_of, festival_active as festival, uplift::float8 as uplift from engine_runs where id = $1",
          [runId],
        ),
    runId == null
      ? []
      : query<{ name: string; action: string; qty: number; cover: number | null; flags: string[]; edge: boolean }>(
          `select s.name, d.action, d.recommended_qty as qty, d.cover_weeks as cover, d.flags, d.is_edge_case as edge
           from demand_signals d join skus s on s.id = d.sku_id where d.run_id = $1 and d.action <> 'hold' and s.archived_at is null order by s.id`,
          [runId],
        ),
    queryOne<{ n: number; cost: number }>(
      `select count(*)::int as n, coalesce(sum(p.final_qty * s.unit_cost_inr), 0)::float8 as cost
       from purchase_orders p join skus s on s.id = p.sku_id where p.status = 'draft'`,
    ),
  ]);
  return { runId, cards, alerts, impact, run, signals, drafts: drafts ?? { n: 0, cost: 0 } };
}

function rulesBrief(g: Awaited<ReturnType<typeof gather>>, note?: string): OpsBrief {
  const crit = g.alerts.filter((a) => a.severity === "critical");
  const reorders = g.signals.filter((s) => s.action === "reorder");
  const pauses = g.signals.filter((s) => s.action === "pause");
  const priorities: OpsBrief["priorities"] = [];
  if (crit.length) {
    priorities.push({
      title: `${crit.length} critical stock alert${crit.length > 1 ? "s" : ""}`,
      detail: crit.slice(0, 3).map((a) => a.title).join("; "),
      severity: "critical",
    });
  }
  if (reorders.length) {
    priorities.push({
      title: `${reorders.length} purchase order${reorders.length > 1 ? "s" : ""} awaiting sign-off`,
      detail: `Largest: ${reorders.sort((a, b) => b.qty - a.qty).slice(0, 2).map((s) => `${s.name.replace(/^Freshroots /, "")} (${s.qty.toLocaleString("en-IN")} units)`).join(", ")}.`,
      severity: "warning",
    });
  }
  if (pauses.length) {
    priorities.push({
      title: `${pauses.length} SKU${pauses.length > 1 ? "s" : ""} paused for overstock`,
      detail: pauses.map((s) => s.name.replace(/^Freshroots /, "")).join(", "),
      severity: "info",
    });
  }
  return {
    headline: crit.length ? `${crit.length} critical stock risk${crit.length > 1 ? "s" : ""} need planner action` : "Operations are within thresholds",
    summary: `${g.run?.festival ? `Festival-season uplift (+${Math.round((g.run.uplift ?? 0) * 100)}%) is applied. ` : ""}Modelled net savings this cycle: ${formatINRCompact(g.impact.netProjectedSavings)} (${formatINRCompact(g.impact.secured + g.impact.pending)} stockout margin protected, ${formatINRCompact(g.impact.avoidedByPause)} over-orders avoided); ${formatINRCompact(g.impact.totalExposure)} of exposure is currently on the shelf.`,
    priorities,
    watch_next: ["Confirm supplier lead times for perishable reorders.", "Re-run the engine after the next stock snapshot."],
    note: note ?? "Rule-based summary. Add GEMINI_API_KEY for a written analysis.",
  };
}

export async function generateOpsBrief(): Promise<StoredBrief | undefined> {
  const g = await gather();
  if (g.runId == null) return undefined;

  let content: OpsBrief;
  let model = "rules";
  let source: "gemini" | "rules" = "rules";
  if (geminiConfigured()) {
    try {
      const facts = {
        as_of: g.run?.as_of,
        festival_month: g.run?.festival,
        metrics: g.cards
          .filter((c) => c.value != null)
          .map((c) => ({ metric: c.def.label, value: c.value, previous: c.previous, unit: c.def.unit, source: c.source })),
        alerts: g.alerts.map((a) => ({ severity: a.severity, title: a.title, message: a.message })),
        planning_actions: g.signals.map((s) => ({ sku: s.name, action: s.action, qty: s.qty, cover_weeks: s.cover, flags: s.flags, needs_review: s.edge })),
        draft_purchase_orders_awaiting_signoff: { count: g.drafts.n, total_cost_inr: Math.round(g.drafts.cost) },
        // These are modelled LOSS figures, not purchase-order values: never describe them as PO value or spend.
        modelled_loss_impact_inr: {
          stockout_margin_at_risk: Math.round(g.impact.stockoutExposure),
          stockout_margin_protected_by_approved_pos: Math.round(g.impact.secured),
          stockout_margin_that_drafts_would_protect_if_approved: Math.round(g.impact.pending),
          overstock_writeoff_risk_on_shelf: Math.round(g.impact.overstockExposure),
          over_orders_avoided_by_pausing_orders: Math.round(g.impact.avoidedByPause),
          net_projected_savings: Math.round(g.impact.netProjectedSavings),
          prices_are_placeholders: g.impact.pricingIsPlaceholder,
        },
      };
      const result = await generateStructured<OpsBrief>({
        system: ANALYST_SYSTEM,
        prompt: `Write the operations brief for the Freshroots executive team. Lead with what needs a decision, quantify the rupee risk, and flag any metric marked source "sample" as illustrative rather than live. Write amounts as ₹ with Indian grouping or lakh/K. Purchase-order cost (draft_purchase_orders_awaiting_signoff) and modelled loss impact (modelled_loss_impact_inr) are different things: never call a loss figure the value of a purchase order. If prices_are_placeholders is true, say the rupee figures rest on placeholder prices. Three priorities at most.\n\nDATA (JSON):\n${JSON.stringify(facts, null, 2)}`,
        schema: SCHEMA,
      });
      content = result.data;
      model = result.model;
      source = "gemini";
    } catch (err) {
      content = rulesBrief(g, `Gemini unavailable (${err instanceof Error ? err.message.slice(0, 140) : "error"}); showing rule-based summary.`);
    }
  } else {
    content = rulesBrief(g);
  }

  await query(
    `insert into ai_outputs (kind, sku_id, run_id, content, model, source) values ('ops_brief', null, $1, $2::jsonb, $3, $4)`,
    [g.runId, JSON.stringify(content), model, source],
  );
  return { content, model, source, createdAt: new Date().toISOString(), runId: g.runId };
}

export async function getLatestBrief(): Promise<StoredBrief | null> {
  const row = await queryOne<{ content: OpsBrief; model: string; source: "gemini" | "rules"; created_at: string; run_id: number }>(
    `select content, model, source, run_id::int as run_id,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
     from ai_outputs where kind = 'ops_brief' order by id desc limit 1`,
  );
  return row ? { content: row.content, model: row.model, source: row.source, createdAt: row.created_at, runId: row.run_id } : null;
}
