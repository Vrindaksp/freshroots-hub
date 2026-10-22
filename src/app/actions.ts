"use server";

import { revalidatePath } from "next/cache";
import { generateOpsBrief } from "@/lib/ai/brief";
import { generateSkuCommentary } from "@/lib/ai/commentary";
import { addPlannerNote } from "@/lib/ai/notes";
import { query, queryOne } from "@/lib/db";
import { getLatestRunId } from "@/lib/engine/run";
import { refreshIntelligence } from "@/lib/intelligence";
import { assertAutomationRunning, setAutomationPaused } from "@/lib/killswitch";
import { refreshStateMetrics } from "@/lib/metrics/snapshot";
import { buildZohoPayload } from "@/lib/zoho";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

// There is no sign-in yet, so decisions are attributed to the role rather than a person.
const ACTOR = "demand-planner";

function refreshViews() {
  revalidatePath("/planner");
  revalidatePath("/executive");
}

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" };
}

export async function runPlanningEngine(): Promise<ActionResult> {
  try {
    const { run, alerts, commentaryGenerated } = await refreshIntelligence();
    refreshViews();
    return {
      ok: true,
      message: `Engine run #${run.runId}: ${run.reorder} reorders, ${run.pause} paused, ${run.edgeCases} edge cases, ${alerts.active} active alerts${commentaryGenerated ? `, ${commentaryGenerated} commentary items` : ""}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

interface PoRow {
  id: number;
  sku_id: string;
  recommended_qty: number;
  status: string;
  name: string;
  cost: number | null;
  uom: string;
  distributor_id: string | null;
  distributor_name: string | null;
}

async function applyDecision(id: number, decision: "approve" | "reject", finalQty: number, reason: string): Promise<void> {
  const po = await queryOne<PoRow>(
    `select p.id::int as id, p.sku_id, p.recommended_qty, p.status, s.name, s.unit_cost_inr::float8 as cost, s.unit_of_measure as uom,
            s.distributor_id, d.name as distributor_name
     from purchase_orders p
     join skus s on s.id = p.sku_id
     left join distributors d on d.id = s.distributor_id
     where p.id = $1`,
    [id],
  );
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "draft") throw new Error(`PO ${id} is already ${po.status}`);

  const trimmed = reason.trim();
  if (!Number.isInteger(finalQty) || finalQty < 0) throw new Error("Final quantity must be a whole number, 0 or more");

  if (decision === "reject") {
    if (trimmed.length < 5) throw new Error("Add a reason (at least 5 characters) when rejecting a recommendation");
    await query(
      `update purchase_orders set status = 'rejected', override_reason = $2, decided_at = now(), decided_by = $3,
              final_qty = $4, zoho_sync_status = 'not_staged', zoho_payload = null
       where id = $1 and status = 'draft'`,
      [id, trimmed, ACTOR, finalQty],
    );
    return;
  }

  if (finalQty === 0) throw new Error("Approve needs a quantity above 0 — reject the draft instead");
  const overridden = finalQty !== po.recommended_qty;
  if (overridden && trimmed.length < 5) {
    throw new Error(`You changed ${po.recommended_qty.toLocaleString("en-IN")} to ${finalQty.toLocaleString("en-IN")} — add an override reason (at least 5 characters)`);
  }

  const payload = buildZohoPayload({
    id: po.id,
    skuId: po.sku_id,
    skuName: po.name,
    qty: finalQty,
    unitCost: po.cost,
    distributorId: po.distributor_id,
    distributorName: po.distributor_name,
    uom: po.uom,
    reason: overridden ? trimmed : null,
    approvedOn: new Date().toISOString().slice(0, 10),
  });
  await query(
    `update purchase_orders set status = 'approved', final_qty = $2, override_reason = $3, decided_at = now(), decided_by = $4,
            zoho_sync_status = 'staged', zoho_payload = $5::jsonb
     where id = $1 and status = 'draft'`,
    [id, finalQty, overridden ? trimmed : null, ACTOR, JSON.stringify(payload)],
  );
}

export async function decidePo(input: {
  id: number;
  decision: "approve" | "reject";
  finalQty: number;
  reason: string;
}): Promise<ActionResult> {
  try {
    await assertAutomationRunning("purchase-order sign-off");
    await applyDecision(input.id, input.decision, input.finalQty, input.reason);
    await refreshStateMetrics();
    refreshViews();
    return { ok: true, message: input.decision === "approve" ? "Approved and staged for Zoho." : "Recommendation rejected." };
  } catch (err) {
    return fail(err);
  }
}

/** Approves every untouched draft that the rules produced and Gemini did not flag for review. */
export async function approveCleanDrafts(): Promise<ActionResult> {
  try {
    await assertAutomationRunning("purchase-order sign-off");
    const runId = await getLatestRunId();
    const drafts = await query<{ id: number; qty: number }>(
      `select p.id::int as id, p.recommended_qty as qty
       from purchase_orders p
       left join demand_signals d on d.sku_id = p.sku_id and d.run_id = $1
       where p.status = 'draft' and p.override_reason is null and p.final_qty = p.recommended_qty
         and coalesce(d.is_edge_case, false) = false
       order by p.id`,
      [runId],
    );
    for (const d of drafts) await applyDecision(d.id, "approve", d.qty, "");
    await refreshStateMetrics();
    refreshViews();
    return { ok: true, message: drafts.length ? `Approved ${drafts.length} rule-clean draft${drafts.length > 1 ? "s" : ""}.` : "No rule-clean drafts to approve." };
  } catch (err) {
    return fail(err);
  }
}

export async function requestCommentary(skuId: string): Promise<ActionResult> {
  try {
    await assertAutomationRunning("Gemini commentary");
    const runId = await getLatestRunId();
    if (runId == null) throw new Error("Run the planning engine first");
    const result = await generateSkuCommentary(runId, skuId);
    if (!result) throw new Error("SKU not found in the latest run");
    refreshViews();
    return { ok: true, message: result.source === "gemini" ? "Gemini commentary updated." : "Rule-based commentary updated." };
  } catch (err) {
    return fail(err);
  }
}

export async function submitPlannerNote(skuId: string, text: string): Promise<ActionResult> {
  try {
    const note = await addPlannerNote(text, skuId, ACTOR);
    refreshViews();
    return { ok: true, message: note.source === "gemini" ? "Note parsed by Gemini." : "Note saved (rule-based parse)." };
  } catch (err) {
    return fail(err);
  }
}

export async function acknowledgeAlert(id: number): Promise<ActionResult> {
  try {
    await query("update alerts set acknowledged_at = now() where id = $1 and acknowledged_at is null", [id]);
    revalidatePath("/executive");
    return { ok: true, message: "Alert acknowledged." };
  } catch (err) {
    return fail(err);
  }
}

export async function regenerateBrief(): Promise<ActionResult> {
  try {
    await assertAutomationRunning("the Gemini brief");
    const brief = await generateOpsBrief();
    if (!brief) throw new Error("Run the planning engine first");
    revalidatePath("/executive");
    return { ok: true, message: brief.source === "gemini" ? "Brief regenerated by Gemini." : "Brief regenerated (rule-based)." };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The kill switch. Pausing needs a reason (it goes in the audit log and on the banner every user sees);
 * resuming is refused while the server-level hard stop (KILL_SWITCH) is set.
 */
export async function setAutomation(input: { paused: boolean; reason: string }): Promise<ActionResult> {
  try {
    await setAutomationPaused(input.paused, input.reason, ACTOR);
    // The banner and header control live in the root layout, so refresh every page.
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: input.paused ? "Automation paused. Engine, Gemini and PO sign-off are stopped." : "Automation resumed.",
    };
  } catch (err) {
    return fail(err);
  }
}
