import type { ZohoConfig } from "./config";
import { buildItemPayload, buildPurchaseOrderPayload, poReference, type ItemSource, type PoLineSource } from "./payloads";

/**
 * Thin Zoho Inventory v1 client. `fetch` is injectable so the request shapes are unit-tested without a Zoho account.
 * Every call goes to {api}/inventory/v1/... with `organization_id` and an OAuth access token minted from the refresh token.
 */

export class ZohoError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ZohoError";
  }
}

export interface ZohoApi {
  organizations(): Promise<{ organization_id: string; name: string }[]>;
  findItemBySku(sku: string): Promise<{ item_id: string } | null>;
  createItem(payload: object): Promise<{ item_id: string }>;
  findVendorByName(name: string): Promise<{ contact_id: string } | null>;
  createVendor(name: string): Promise<{ contact_id: string }>;
  findPurchaseOrderByReference(reference: string): Promise<{ purchaseorder_id: string; purchaseorder_number: string } | null>;
  createPurchaseOrder(payload: object): Promise<{ purchaseorder_id: string; purchaseorder_number: string }>;
}

// Zoho throttles token refreshes, so an access token is reused until shortly before it expires.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(cfg: ZohoConfig, f: typeof fetch, force = false): Promise<string> {
  const key = `${cfg.accountsBase}|${cfg.clientId}|${cfg.refreshToken}`;
  const hit = tokenCache.get(key);
  if (!force && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await f(`${cfg.accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) {
    throw new ZohoError(`Zoho rejected the credentials (${json.error ?? `HTTP ${res.status}`}). Check ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_DC.`, undefined, res.status);
  }
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

export function clearZohoTokenCache() {
  tokenCache.clear();
}

export function createZohoApi(cfg: ZohoConfig, f: typeof fetch = fetch): ZohoApi {
  async function request(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: object; orgScoped?: boolean } = {}) {
    const url = new URL(`${cfg.apiBase}/inventory/v1${path}`);
    if (opts.orgScoped !== false) url.searchParams.set("organization_id", cfg.organizationId);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(cfg, f, attempt === 1);
      const res = await f(url, {
        method,
        headers: { authorization: `Zoho-oauthtoken ${token}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 401 && attempt === 0) continue; // expired token: mint a fresh one and retry once

      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ZohoError(`Zoho returned a non-JSON response (HTTP ${res.status}).`, undefined, res.status);
      }
      const code = typeof json.code === "number" ? json.code : undefined;
      if (!res.ok || (code !== undefined && code !== 0)) {
        throw new ZohoError(String(json.message ?? `HTTP ${res.status}`), code, res.status);
      }
      return json;
    }
    throw new ZohoError("Zoho kept rejecting the access token.", undefined, 401);
  }

  const same = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

  return {
    async organizations() {
      const json = await request("GET", "/organizations", { orgScoped: false });
      return (json.organizations as { organization_id: string; name: string }[] | undefined) ?? [];
    },
    async findItemBySku(sku) {
      const json = await request("GET", "/items", { query: { sku } });
      const items = (json.items as { item_id: string; sku?: string }[] | undefined) ?? [];
      return items.find((i) => same(i.sku, sku)) ?? null;
    },
    async createItem(payload) {
      const json = await request("POST", "/items", { body: payload });
      const item = json.item as { item_id: string } | undefined;
      if (!item?.item_id) throw new ZohoError("Zoho created the item but did not return its id.");
      return item;
    },
    async findVendorByName(name) {
      const json = await request("GET", "/contacts", { query: { search_text: name } });
      const contacts = (json.contacts as { contact_id: string; contact_name?: string; contact_type?: string }[] | undefined) ?? [];
      return contacts.find((c) => same(c.contact_name, name) && (c.contact_type ?? "vendor") === "vendor") ?? null;
    },
    async createVendor(name) {
      const json = await request("POST", "/contacts", { body: { contact_name: name, contact_type: "vendor" } });
      const contact = json.contact as { contact_id: string } | undefined;
      if (!contact?.contact_id) throw new ZohoError("Zoho created the vendor but did not return its id.");
      return contact;
    },
    async findPurchaseOrderByReference(reference) {
      const json = await request("GET", "/purchaseorders", { query: { reference_number: reference } });
      const pos = (json.purchaseorders as { purchaseorder_id: string; purchaseorder_number: string; reference_number?: string }[] | undefined) ?? [];
      return pos.find((p) => same(p.reference_number, reference)) ?? null;
    },
    async createPurchaseOrder(payload) {
      const json = await request("POST", "/purchaseorders", { body: payload });
      const po = json.purchaseorder as { purchaseorder_id: string; purchaseorder_number: string } | undefined;
      if (!po?.purchaseorder_id) throw new ZohoError("Zoho created the purchase order but did not return its id.");
      return po;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Orchestration on top of the API (no database here, so it is testable with a fake ZohoApi)
// ---------------------------------------------------------------------------------------------------------------------

/** Find the Zoho item for a SKU by its SKU code, creating it when missing. */
export async function ensureItem(api: ZohoApi, sku: ItemSource): Promise<{ itemId: string; created: boolean }> {
  const found = await api.findItemBySku(sku.id);
  if (found) return { itemId: found.item_id, created: false };
  const created = await api.createItem(buildItemPayload(sku));
  return { itemId: created.item_id, created: true };
}

export interface PoPushInput {
  sku: ItemSource;
  zohoItemId: string | null;
  vendorName: string | null;
  line: PoLineSource;
}

export interface PoPushResult {
  zohoItemId: string;
  itemCreated: boolean;
  zohoVendorId: string;
  zohoPoId: string;
  zohoPoNumber: string;
  /** False when a purchase order with this reference already existed in Zoho, so nothing new was created. */
  created: boolean;
}

/**
 * Push one approved PO. Safe to retry: the PO is looked up by its reference number first, so a retry after a half-finished
 * attempt links to the existing Zoho PO instead of creating a duplicate.
 */
export async function pushPurchaseOrder(api: ZohoApi, input: PoPushInput, vendorCache: Map<string, string> = new Map()): Promise<PoPushResult> {
  if (!input.vendorName) throw new Error("This SKU has no distributor, so there is no Zoho vendor to raise the PO against.");

  let zohoItemId = input.zohoItemId;
  let itemCreated = false;
  if (!zohoItemId) {
    const item = await ensureItem(api, input.sku);
    zohoItemId = item.itemId;
    itemCreated = item.created;
  }

  let vendorId = vendorCache.get(input.vendorName.toLowerCase());
  if (!vendorId) {
    vendorId = (await api.findVendorByName(input.vendorName))?.contact_id ?? (await api.createVendor(input.vendorName)).contact_id;
    vendorCache.set(input.vendorName.toLowerCase(), vendorId);
  }

  const existing = await api.findPurchaseOrderByReference(poReference(input.line.poId));
  if (existing) {
    return { zohoItemId, itemCreated, zohoVendorId: vendorId, zohoPoId: existing.purchaseorder_id, zohoPoNumber: existing.purchaseorder_number, created: false };
  }
  const po = await api.createPurchaseOrder(buildPurchaseOrderPayload(input.line, vendorId, zohoItemId));
  return { zohoItemId, itemCreated, zohoVendorId: vendorId, zohoPoId: po.purchaseorder_id, zohoPoNumber: po.purchaseorder_number, created: true };
}
