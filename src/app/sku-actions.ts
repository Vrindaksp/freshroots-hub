"use server";

import { revalidatePath } from "next/cache";
import { runAlertChecks } from "@/lib/alerts/run";
import { query, queryOne } from "@/lib/db";
import { refreshStateMetrics } from "@/lib/metrics/snapshot";
import { validateSkuInput, type SkuFormInput } from "@/lib/skus/validate";

export type SkuResult = { ok: true; message: string; skuId?: string } | { ok: false; error: string; fields?: Record<string, string> };

// No user accounts yet, so changes are attributed to the role.
const ACTOR = "demand-planner";

function refreshViews() {
  revalidatePath("/skus");
  revalidatePath("/planner");
  revalidatePath("/executive");
  revalidatePath("/zoho");
}

function fail(err: unknown): SkuResult {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
}

async function logEvent(skuId: string, action: "add" | "edit" | "archive" | "restore" | "delete", detail: Record<string, unknown> = {}) {
  await query("insert into sku_events (sku_id, action, detail, actor) values ($1, $2, $3::jsonb, $4)", [skuId, action, JSON.stringify(detail), ACTOR]);
}

async function validationContext() {
  const [skus, distributors] = await Promise.all([
    query<{ id: string }>("select id from skus"),
    query<{ id: string }>("select id from distributors"),
  ]);
  return { existingIds: skus.map((s) => s.id), distributorIds: distributors.map((d) => d.id) };
}

function invalid(errors: Record<string, string>): SkuResult {
  return { ok: false, error: Object.values(errors).join(" "), fields: errors };
}

export async function addSku(input: SkuFormInput): Promise<SkuResult> {
  try {
    const ctx = await validationContext();
    const result = validateSkuInput(input, { ...ctx, mode: "add" });
    if (!result.ok) return invalid(result.errors);
    const v = result.value;

    await query(
      `insert into skus (id, name, category, perishability_level, perishability_flag, standard_order_qty, unit_of_measure,
                         distributor_id, unit_cost_inr, unit_price_inr, pricing_source, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, 'manual')`,
      [
        v.id, v.name, v.category, v.perishability, v.perishability === "High", v.standardOrderQty, v.unitOfMeasure,
        v.distributorId, v.unitCost, v.unitPrice, v.unitCost != null || v.unitPrice != null ? "manual" : null,
      ],
    );

    // Opening stock joins the current stock snapshot so cover is computed against the same as-of date as every other SKU.
    const location =
      v.location ??
      (await queryOne<{ location: string }>("select location from inventory_levels group by location order by count(*) desc, location limit 1"))?.location ??
      "Main";
    await query(
      `insert into inventory_levels (sku_id, location, current_stock_units, as_of_date)
       values ($1, $2, $3, coalesce((select max(as_of_date) from inventory_levels), current_date))`,
      [v.id, location, v.openingStock],
    );

    await logEvent(v.id, "add", { name: v.name, openingStock: v.openingStock, location });
    refreshViews();
    return { ok: true, skuId: v.id, message: `${v.id} added. Run the planning engine to bring it into the planner.` };
  } catch (err) {
    return fail(err);
  }
}

export async function updateSku(skuId: string, input: SkuFormInput): Promise<SkuResult> {
  try {
    const existing = await queryOne<{ id: string; archived_at: string | null }>("select id, archived_at::text as archived_at from skus where id = $1", [skuId]);
    if (!existing) return { ok: false, error: `${skuId} was not found.` };
    if (existing.archived_at) return { ok: false, error: `${skuId} is removed. Restore it before editing.` };

    const ctx = await validationContext();
    const result = validateSkuInput(input, { ...ctx, mode: "edit", fixedId: skuId });
    if (!result.ok) return invalid(result.errors);
    const v = result.value;

    // Only a real change to cost/price marks the pricing as manually entered; re-saving a form with the old numbers must not.
    await query(
      `update skus set
         name = $2, category = $3, perishability_level = $4, perishability_flag = $5, standard_order_qty = $6,
         unit_of_measure = $7, distributor_id = $8,
         pricing_source = case
           when unit_cost_inr is not distinct from $9::numeric and unit_price_inr is not distinct from $10::numeric then pricing_source
           when $9::numeric is null and $10::numeric is null then null
           else 'manual' end,
         unit_cost_inr = $9::numeric, unit_price_inr = $10::numeric
       where id = $1`,
      [skuId, v.name, v.category, v.perishability, v.perishability === "High", v.standardOrderQty, v.unitOfMeasure, v.distributorId, v.unitCost, v.unitPrice],
    );
    await logEvent(skuId, "edit", { name: v.name, standardOrderQty: v.standardOrderQty, unitCost: v.unitCost, unitPrice: v.unitPrice });
    refreshViews();
    return { ok: true, skuId, message: `${skuId} updated. Run the planning engine to apply the change to recommendations.` };
  } catch (err) {
    return fail(err);
  }
}

/** "Remove": hides the SKU everywhere and drops its open draft POs, but keeps every sale and past PO. Reversible. */
export async function archiveSku(skuId: string, reason: string): Promise<SkuResult> {
  try {
    const clean = reason.trim();
    if (clean.length < 5) return { ok: false, error: "Give a reason (at least 5 characters) so the next person knows why it was removed." };
    const existing = await queryOne<{ archived_at: string | null }>("select archived_at::text as archived_at from skus where id = $1", [skuId]);
    if (!existing) return { ok: false, error: `${skuId} was not found.` };
    if (existing.archived_at) return { ok: false, error: `${skuId} is already removed.` };

    await query("update skus set archived_at = now(), archived_reason = $2 where id = $1", [skuId, clean]);
    const drafts = await query<{ id: number }>("delete from purchase_orders where sku_id = $1 and status = 'draft' returning id::int as id", [skuId]);
    await logEvent(skuId, "archive", { reason: clean, draftsDropped: drafts.length });

    // Make the dashboards forget it straight away instead of waiting for the next engine run.
    try {
      await runAlertChecks();
      await refreshStateMetrics();
    } catch {
      /* the next scheduled refresh will reconcile */
    }
    refreshViews();
    return {
      ok: true,
      skuId,
      message: `${skuId} removed${drafts.length ? ` and ${drafts.length} open draft PO${drafts.length > 1 ? "s" : ""} dropped` : ""}. Its history is kept; restore it any time.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreSku(skuId: string): Promise<SkuResult> {
  try {
    const rows = await query<{ id: string }>("update skus set archived_at = null, archived_reason = null where id = $1 and archived_at is not null returning id", [skuId]);
    if (!rows.length) return { ok: false, error: `${skuId} is not a removed SKU.` };
    await logEvent(skuId, "restore");
    refreshViews();
    return { ok: true, skuId, message: `${skuId} restored. Run the planning engine to bring it back into the planner.` };
  } catch (err) {
    return fail(err);
  }
}

/** Irreversible. Only for SKUs created by mistake: anything with sales history or decided POs must stay as an archive. */
export async function deleteSkuPermanently(skuId: string, confirmId: string): Promise<SkuResult> {
  try {
    if (confirmId.trim() !== skuId) return { ok: false, error: `Type ${skuId} exactly to confirm permanent deletion.` };
    const sku = await queryOne<{ name: string; archived_at: string | null; sales: number; decided: number }>(
      `select s.name, s.archived_at::text as archived_at,
              (select count(*) from sales_history h where h.sku_id = s.id)::int as sales,
              (select count(*) from purchase_orders p where p.sku_id = s.id and p.status <> 'draft')::int as decided
       from skus s where s.id = $1`,
      [skuId],
    );
    if (!sku) return { ok: false, error: `${skuId} was not found.` };
    if (!sku.archived_at) return { ok: false, error: "Remove the SKU first; only a removed SKU can be deleted permanently." };
    if (sku.sales > 0 || sku.decided > 0) {
      return {
        ok: false,
        error: `${skuId} has ${sku.sales} sales record${sku.sales === 1 ? "" : "s"} and ${sku.decided} decided purchase order${sku.decided === 1 ? "" : "s"}. Deleting would rewrite history, so it stays removed instead.`,
      };
    }

    await query("delete from demand_signals where sku_id = $1", [skuId]);
    await query("delete from ai_outputs where sku_id = $1", [skuId]);
    await query("delete from planner_notes where sku_id = $1", [skuId]);
    await query("delete from alerts where sku_id = $1", [skuId]);
    await query("delete from purchase_orders where sku_id = $1", [skuId]);
    await query("delete from inventory_levels where sku_id = $1", [skuId]);
    await query("delete from skus where id = $1", [skuId]);
    await logEvent(skuId, "delete", { name: sku.name });
    refreshViews();
    return { ok: true, message: `${skuId} permanently deleted.` };
  } catch (err) {
    return fail(err);
  }
}
