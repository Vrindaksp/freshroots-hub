import { query, queryOne } from "../db";
import { assertAutomationRunning } from "../killswitch";
import { createZohoApi, ensureItem, pushPurchaseOrder, ZohoError, type ZohoApi } from "./api";
import { readZohoConfig } from "./config";
import { buildPurchaseOrderPayload, poReference } from "./payloads";

type LogKind = "test" | "item" | "purchase_order";

async function logSync(kind: LogKind, ref: string | null, ok: boolean, message: string): Promise<void> {
  try {
    await query("insert into zoho_sync_log (kind, ref, ok, message) values ($1, $2, $3, $4)", [kind, ref, ok, message.slice(0, 500)]);
  } catch {
    /* logging must never break a sync */
  }
}

const describe = (e: unknown) => (e instanceof ZohoError ? `${e.message}${e.code ? ` (Zoho code ${e.code})` : ""}` : e instanceof Error ? e.message : "Unexpected error");

function connectedApi(): ZohoApi {
  const s = readZohoConfig();
  if (!s.config) throw new Error(s.problem ?? `Zoho is not connected yet. Missing: ${s.missing.join(", ")}. See the setup guide on the Zoho page.`);
  return createZohoApi(s.config);
}

/** Read-only: confirms the credentials work and the organisation id is one this token can see. */
export async function testZohoConnection(): Promise<{ ok: boolean; message: string }> {
  const s = readZohoConfig();
  if (!s.config) {
    return { ok: false, message: s.problem ?? `Not connected yet. Missing: ${s.missing.join(", ")}.` };
  }
  let result: { ok: boolean; message: string };
  try {
    const orgs = await createZohoApi(s.config).organizations();
    const mine = orgs.find((o) => o.organization_id === s.config!.organizationId);
    result = mine
      ? { ok: true, message: `Connected to “${mine.name}” (organization ${mine.organization_id}, data centre .${s.dc}).` }
      : { ok: false, message: `Credentials work, but organization ${s.config.organizationId} is not one of the ${orgs.length} this token can see (${orgs.map((o) => `${o.name} = ${o.organization_id}`).join("; ") || "none"}).` };
  } catch (e) {
    result = { ok: false, message: describe(e) };
  }
  await logSync("test", null, result.ok, result.message);
  return result;
}

interface PendingPo {
  id: number;
  sku_id: string;
  qty: number;
  override_reason: string | null;
  status: string;
  decided_on: string;
  zoho_po_number: string | null;
  zoho_error: string | null;
  name: string;
  category: string;
  perishable: boolean;
  uom: string;
  cost: number | null;
  price: number | null;
  zoho_item_id: string | null;
  vendor: string | null;
}

const PENDING_SELECT = `select p.id::int as id, p.sku_id, p.final_qty::int as qty, p.override_reason, p.zoho_sync_status as status,
       to_char(coalesce(p.decided_at, p.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on, p.zoho_po_number, p.zoho_error,
       s.name, s.category, s.perishability_flag as perishable, s.unit_of_measure as uom,
       s.unit_cost_inr::float8 as cost, s.unit_price_inr::float8 as price, s.zoho_item_id, d.name as vendor
     from purchase_orders p
     join skus s on s.id = p.sku_id
     left join distributors d on d.id = s.distributor_id
     where p.status = 'approved'`;

export interface PushPreviewLine {
  poId: number;
  reference: string;
  skuId: string;
  skuName: string;
  quantity: number;
  rate: number;
  vendor: string | null;
  itemInZoho: boolean;
  warnings: string[];
  payload: object;
}

/** Dry run: exactly what a push would send, built from the database alone (no Zoho call, works without credentials). */
export async function previewZohoPush(): Promise<PushPreviewLine[]> {
  const rows = await query<PendingPo>(`${PENDING_SELECT} and p.zoho_sync_status <> 'pushed' order by p.id`);
  return rows.map((r) => {
    const warnings: string[] = [];
    if (!r.vendor) warnings.push("SKU has no distributor, so no Zoho vendor — this PO will fail until one is set.");
    if (r.cost == null) warnings.push("No unit cost: the line is sent with rate 0.");
    if (!r.zoho_item_id) warnings.push("Item is not linked to Zoho yet; it will be looked up by SKU or created first.");
    return {
      poId: r.id,
      reference: poReference(r.id),
      skuId: r.sku_id,
      skuName: r.name,
      quantity: r.qty,
      rate: r.cost ?? 0,
      vendor: r.vendor,
      itemInZoho: Boolean(r.zoho_item_id),
      warnings,
      payload: buildPurchaseOrderPayload(
        { poId: r.id, skuName: r.name, unitOfMeasure: r.uom, quantity: r.qty, rate: r.cost ?? 0, date: r.decided_on, overrideReason: r.override_reason },
        "<vendor id looked up or created in Zoho>",
        r.zoho_item_id ?? "<item id looked up or created in Zoho>",
      ),
    };
  });
}

export interface PushOutcome {
  poId: number;
  reference: string;
  ok: boolean;
  message: string;
}

/** Push every approved, not-yet-pushed PO to Zoho as a draft purchase order. One failure never stops the rest. */
export async function pushApprovedPurchaseOrders(api: ZohoApi = connectedApi()): Promise<{ pushed: number; linked: number; failed: number; outcomes: PushOutcome[] }> {
  await assertAutomationRunning("the Zoho push");
  const rows = await query<PendingPo>(`${PENDING_SELECT} and p.zoho_sync_status <> 'pushed' order by p.id`);
  const vendorCache = new Map<string, string>();
  const outcomes: PushOutcome[] = [];

  for (const r of rows) {
    const reference = poReference(r.id);
    try {
      const result = await pushPurchaseOrder(
        api,
        {
          sku: { id: r.sku_id, name: r.name, category: r.category, perishable: r.perishable, unitOfMeasure: r.uom, unitCost: r.cost, unitPrice: r.price },
          zohoItemId: r.zoho_item_id,
          vendorName: r.vendor,
          line: { poId: r.id, skuName: r.name, unitOfMeasure: r.uom, quantity: r.qty, rate: r.cost ?? 0, date: r.decided_on, overrideReason: r.override_reason },
        },
        vendorCache,
      );
      if (result.zohoItemId !== r.zoho_item_id) {
        await query("update skus set zoho_item_id = $2, zoho_synced_at = now() where id = $1", [r.sku_id, result.zohoItemId]);
      }
      await query(
        `update purchase_orders set zoho_sync_status = 'pushed', zoho_po_id = $2, zoho_po_number = $3, zoho_synced_at = now(), zoho_error = null where id = $1`,
        [r.id, result.zohoPoId, result.zohoPoNumber],
      );
      const message = result.created ? `Created Zoho purchase order ${result.zohoPoNumber} (draft).` : `Already in Zoho as ${result.zohoPoNumber}; linked, nothing duplicated.`;
      await logSync("purchase_order", reference, true, message);
      outcomes.push({ poId: r.id, reference, ok: true, message });
    } catch (e) {
      const message = describe(e);
      await query("update purchase_orders set zoho_sync_status = 'failed', zoho_error = $2 where id = $1", [r.id, message.slice(0, 500)]);
      await logSync("purchase_order", reference, false, message);
      outcomes.push({ poId: r.id, reference, ok: false, message });
    }
  }
  return {
    pushed: outcomes.filter((o) => o.ok && /^Created/.test(o.message)).length,
    linked: outcomes.filter((o) => o.ok && /^Already/.test(o.message)).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  };
}

/** Create or link one SKU as a Zoho item (matched by SKU code, so it never duplicates an existing item). */
export async function syncSkuToZohoItem(skuId: string, api: ZohoApi = connectedApi()): Promise<{ itemId: string; created: boolean }> {
  await assertAutomationRunning("the Zoho item sync");
  const s = await queryOne<{ id: string; name: string; category: string; perishable: boolean; uom: string; cost: number | null; price: number | null; archived: boolean }>(
    `select id, name, category, perishability_flag as perishable, unit_of_measure as uom, unit_cost_inr::float8 as cost, unit_price_inr::float8 as price,
            archived_at is not null as archived
     from skus where id = $1`,
    [skuId],
  );
  if (!s) throw new Error(`${skuId} was not found.`);
  if (s.archived) throw new Error(`${skuId} is removed; restore it before syncing to Zoho.`);
  try {
    const result = await ensureItem(api, { id: s.id, name: s.name, category: s.category, perishable: s.perishable, unitOfMeasure: s.uom, unitCost: s.cost, unitPrice: s.price });
    await query("update skus set zoho_item_id = $2, zoho_synced_at = now() where id = $1", [skuId, result.itemId]);
    await logSync("item", skuId, true, result.created ? `Created Zoho item ${result.itemId}.` : `Linked to existing Zoho item ${result.itemId}.`);
    return result;
  } catch (e) {
    await logSync("item", skuId, false, describe(e));
    throw new Error(describe(e));
  }
}

export async function syncAllSkusToZoho(api: ZohoApi = connectedApi()): Promise<{ created: number; linked: number; failed: { skuId: string; message: string }[] }> {
  await assertAutomationRunning("the Zoho item sync");
  const skus = await query<{ id: string }>("select id from skus where archived_at is null order by id");
  let created = 0;
  let linked = 0;
  const failed: { skuId: string; message: string }[] = [];
  for (const s of skus) {
    try {
      const r = await syncSkuToZohoItem(s.id, api);
      if (r.created) created++;
      else linked++;
    } catch (e) {
      failed.push({ skuId: s.id, message: e instanceof Error ? e.message : "failed" });
    }
  }
  return { created, linked, failed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Read model for the Zoho page
// ---------------------------------------------------------------------------------------------------------------------

export interface ZohoOverview {
  configured: boolean;
  dc: string;
  missing: string[];
  problem: string | null;
  organizationHint: string | null;
  counts: { awaiting: number; pushed: number; failed: number; itemsLinked: number; itemsActive: number };
  pos: { id: number; reference: string; skuName: string; qty: number; status: string; zohoNumber: string | null; error: string | null }[];
  log: { id: number; kind: string; ref: string | null; ok: boolean; message: string; at: string }[];
}

export async function getZohoOverview(): Promise<ZohoOverview> {
  const s = readZohoConfig();
  const [counts, pos, log, items] = await Promise.all([
    queryOne<{ awaiting: number; pushed: number; failed: number }>(
      `select count(*) filter (where zoho_sync_status in ('staged', 'not_staged'))::int as awaiting,
              count(*) filter (where zoho_sync_status = 'pushed')::int as pushed,
              count(*) filter (where zoho_sync_status = 'failed')::int as failed
       from purchase_orders where status = 'approved'`,
    ),
    query<{ id: number; sku_name: string; qty: number; status: string; zoho_po_number: string | null; zoho_error: string | null }>(
      `select p.id::int as id, s.name as sku_name, p.final_qty::int as qty, p.zoho_sync_status as status, p.zoho_po_number, p.zoho_error
       from purchase_orders p join skus s on s.id = p.sku_id where p.status = 'approved' order by p.id desc limit 25`,
    ),
    query<{ id: number; kind: string; ref: string | null; ok: boolean; message: string; at: string }>(
      `select id::int as id, kind, ref, ok, message, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
       from zoho_sync_log order by id desc limit 10`,
    ),
    queryOne<{ linked: number; active: number }>(
      "select count(*) filter (where zoho_item_id is not null)::int as linked, count(*)::int as active from skus where archived_at is null",
    ),
  ]);
  const org = s.config?.organizationId ?? null;
  return {
    configured: Boolean(s.config),
    dc: s.dc,
    missing: s.missing,
    problem: s.problem,
    organizationHint: org ? `…${org.slice(-4)}` : null,
    counts: { awaiting: counts?.awaiting ?? 0, pushed: counts?.pushed ?? 0, failed: counts?.failed ?? 0, itemsLinked: items?.linked ?? 0, itemsActive: items?.active ?? 0 },
    pos: pos.map((p) => ({ id: p.id, reference: poReference(p.id), skuName: p.sku_name, qty: p.qty, status: p.status, zohoNumber: p.zoho_po_number, error: p.zoho_error })),
    log,
  };
}
