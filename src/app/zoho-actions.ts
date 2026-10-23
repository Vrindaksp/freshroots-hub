"use server";

import { revalidatePath } from "next/cache";
import { readZohoConfig } from "@/lib/zoho/config";
import {
  previewZohoPush,
  pushApprovedPurchaseOrders,
  syncAllSkusToZoho as syncAllSkusToZohoLib,
  syncSkuToZohoItem,
  testZohoConnection,
  type PushOutcome,
  type PushPreviewLine,
} from "@/lib/zoho/sync";
import type { ActionResult } from "./actions";

function refreshViews() {
  revalidatePath("/zoho");
  revalidatePath("/skus");
  revalidatePath("/planner");
}

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

export async function testZohoConnectionAction(): Promise<ActionResult> {
  const r = await testZohoConnection();
  revalidatePath("/zoho");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

export async function previewZohoPushAction(): Promise<{ ok: true; lines: PushPreviewLine[] } | { ok: false; error: string }> {
  try {
    return { ok: true, lines: await previewZohoPush() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not build the preview" };
  }
}

export type PushResult = { ok: true; message: string; outcomes: PushOutcome[] } | { ok: false; error: string; outcomes?: PushOutcome[] };

export async function pushPurchaseOrdersToZoho(): Promise<PushResult> {
  try {
    const { pushed, linked, failed, outcomes } = await pushApprovedPurchaseOrders();
    refreshViews();
    if (!outcomes.length) return { ok: true, message: "Nothing to push: every approved purchase order is already in Zoho.", outcomes };
    const parts = [pushed && `${pushed} created in Zoho`, linked && `${linked} already there and linked`, failed && `${failed} failed`].filter(Boolean).join(", ");
    return failed && !pushed && !linked ? { ok: false, error: parts, outcomes } : { ok: true, message: parts, outcomes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Push failed" };
  }
}

export async function syncSkuToZoho(skuId: string): Promise<ActionResult> {
  try {
    const r = await syncSkuToZohoItem(skuId);
    refreshViews();
    return { ok: true, message: r.created ? `${skuId} created in Zoho as item ${r.itemId}.` : `${skuId} linked to the existing Zoho item ${r.itemId}.` };
  } catch (e) {
    refreshViews();
    return fail(e);
  }
}

export async function syncAllSkusToZoho(): Promise<ActionResult> {
  try {
    const r = await syncAllSkusToZohoLib();
    refreshViews();
    const summary = `${r.created} created, ${r.linked} linked to existing items${r.failed.length ? `, ${r.failed.length} failed (${r.failed.slice(0, 3).map((f) => `${f.skuId}: ${f.message}`).join("; ")})` : ""}.`;
    return r.failed.length && !r.created && !r.linked ? { ok: false, error: summary } : { ok: true, message: summary };
  } catch (e) {
    return fail(e);
  }
}

/** For the page: is the connection configured (never returns secrets). */
export async function zohoIsConfigured(): Promise<boolean> {
  return Boolean(readZohoConfig().config);
}
