import { queryOne } from "../db";
import { IMPACT_ASSUMPTIONS } from "../engine/config";
import { formatINR, formatINRCompact } from "../format";
import { getImpact } from "../impact";
import type { CheckKey } from "./checks";

/**
 * Live facts from the running system, shown beside each check so the person answering is not working from memory.
 * Evidence informs the answer; it never sets it. Every line here is read from the database or the model, nothing is invented.
 */
export async function getDecisionEvidence(): Promise<Record<CheckKey, string[]>> {
  const [sales, stock, cal, runs, latest, pos, alerts, zohoPos, zohoSkus, samples, impact] = await Promise.all([
    queryOne<{ rows: number; weeks: number; skus: number; first: string | null; last: string | null }>(
      `select count(*)::int as rows, count(distinct date_trunc('week', date))::int as weeks, count(distinct sku_id)::int as skus,
              to_char(min(date), 'YYYY-MM-DD') as first, to_char(max(date), 'YYYY-MM-DD') as last
       from sales_history`,
    ),
    queryOne<{ as_of: string | null; skus: number }>(
      "select to_char(max(as_of_date), 'YYYY-MM-DD') as as_of, count(distinct sku_id)::int as skus from inventory_levels",
    ),
    queryOne<{ months: number; festival: number }>("select count(*)::int as months, count(*) filter (where is_festival_month)::int as festival from calendar"),
    queryOne<{ n: number; last_run: string | null }>("select count(*)::int as n, to_char(max(ran_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as last_run from engine_runs"),
    queryOne<{ summary: { edgeCases?: number; evaluated?: number } }>("select summary from engine_runs order by id desc limit 1"),
    queryOne<{ approved: number; rejected: number; drafts: number; overridden: number }>(
      `select count(*) filter (where status = 'approved')::int as approved, count(*) filter (where status = 'rejected')::int as rejected,
              count(*) filter (where status = 'draft')::int as drafts,
              count(*) filter (where status = 'approved' and override_reason is not null)::int as overridden
       from purchase_orders`,
    ),
    queryOne<{ total: number; acked: number }>("select count(*)::int as total, count(*) filter (where acknowledged_at is not null)::int as acked from alerts"),
    queryOne<{ pushed: number }>("select count(*) filter (where zoho_sync_status = 'pushed')::int as pushed from purchase_orders where status = 'approved'"),
    queryOne<{ linked: number; active: number }>("select count(*) filter (where zoho_item_id is not null)::int as linked, count(*)::int as active from skus where archived_at is null"),
    queryOne<{ n: number }>("select count(distinct metric_name)::int as n from operational_metrics where source = 'sample'"),
    getImpact(),
  ]);

  // Safe here: this runs after awaited queries, so the page is already request-time.
  const ageDays = stock?.as_of ? Math.max(0, Math.floor((Date.now() - new Date(`${stock.as_of}T00:00:00Z`).getTime()) / 86_400_000)) : null;
  const priceNote = impact.pricingIsPlaceholder ? "placeholder prices" : "your prices";
  const edge = latest?.summary?.edgeCases ?? 0;
  const evaluated = latest?.summary?.evaluated ?? 0;
  const base = IMPACT_ASSUMPTIONS.quarterlyBaselineLakh;

  return {
    problem_cost: [
      `Baseline from the brief: ₹${base.low}–${base.high} L lost per quarter to planning errors. This app does not measure that number.`,
      `Exposure measured on ${impact.skuCount} SKUs right now: stockout margin ${formatINR(impact.stockoutExposure)}, overstock write-off risk ${formatINR(impact.overstockExposure)} (${priceNote}).`,
    ],
    problem_people: ["From the case: Raghav pulls two days of SAP data into Excel each month; Priya spends four hours every Monday on the CEO dashboard."],
    workflow_repeat: [
      `The planning engine runs on a daily schedule (06:00 IST): ${runs?.n ?? 0} runs on record, latest ${runs?.last_run ? `${runs.last_run} UTC` : "none"}.`,
      "Cadences from the case: a monthly demand forecast and a weekly operations dashboard.",
    ],
    workflow_rules: [
      "Codified and unit-tested: reorder under 6 weeks, pause over 14, +20% sales → 1.5× order, +25% festival uplift (Oct, Nov, Mar), perishables 3–4 weeks.",
      `Cases that still need human judgment in the latest run: ${edge} of ${evaluated} SKUs${evaluated ? ` (${Math.round((edge / evaluated) * 100)}%)` : ""}.`,
    ],
    input_present: [
      `Sales: ${sales?.rows ?? 0} rows over ${sales?.weeks ?? 0} weeks for ${sales?.skus ?? 0} SKUs (${sales?.first ?? "—"} → ${sales?.last ?? "—"}).`,
      `Stock snapshot as of ${stock?.as_of ?? "—"} for ${stock?.skus ?? 0} SKUs.`,
      `Calendar: ${cal?.months ?? 0} months loaded, ${cal?.festival ?? 0} marked festival.`,
    ],
    input_quality: [
      ageDays == null ? "No stock snapshot loaded." : `The stock snapshot is ${ageDays} day${ageDays === 1 ? "" : "s"} old.`,
      `${sales?.weeks ?? 0} weeks of sales history (12 are needed for the 12-week average).`,
      `${samples?.n ?? 0} of 12 dashboard metrics are illustrative samples with no real source yet.`,
      "The source files carry no unit prices, open purchase orders, or distributor and channel detail on sales.",
    ],
    output_used: [
      `Purchase orders: ${pos?.approved ?? 0} approved (${pos?.overridden ?? 0} with an override), ${pos?.rejected ?? 0} rejected, ${pos?.drafts ?? 0} waiting for a decision.`,
      `Alerts: ${alerts?.acked ?? 0} of ${alerts?.total ?? 0} acknowledged.`,
    ],
    output_fit: [
      `Zoho Inventory: ${zohoPos?.pushed ?? 0} approved POs pushed as drafts, ${zohoSkus?.linked ?? 0} of ${zohoSkus?.active ?? 0} SKUs linked.`,
      "CSV and JSON exports are available for Zoho's import wizard, and the Executive view carries the twelve metrics the CEO expects.",
    ],
    roi: [
      `Modelled net savings this cycle: ${formatINRCompact(impact.netProjectedSavings)} on ${priceNote}. It is a model, not accounting.`,
      "Budget and timeline from the brief: ₹15 L over 90 days.",
      "Running cost (Vercel, Neon, Gemini usage) is not tracked in the app, so the return cannot be fully computed here.",
    ],
  };
}

