import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { clearZohoTokenCache, createZohoApi, ensureItem, pushPurchaseOrder, ZohoError, type ZohoApi } from "./api";
import { readZohoConfig } from "./config";
import { buildItemPayload, buildPurchaseOrderPayload, csvEscape, itemsCsv, poReference, purchaseOrdersCsv } from "./payloads";

const ENV = { ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "sec", ZOHO_REFRESH_TOKEN: "rt", ZOHO_ORGANIZATION_ID: "123" };
const cfg = readZohoConfig(ENV).config!;

const sku = { id: "SKU016", name: "Freshroots Jaggery 500g", category: "Staple", perishable: false, unitOfMeasure: "Units", unitCost: 40, unitPrice: 55 };

describe("config", () => {
  it("defaults to the India data centre and reports nothing missing when complete", () => {
    const s = readZohoConfig(ENV);
    assert.equal(s.dc, "in");
    assert.equal(s.config?.apiBase, "https://www.zohoapis.in");
    assert.equal(s.config?.accountsBase, "https://accounts.zoho.in");
    assert.deepEqual(s.missing, []);
  });

  it("lists which variables are missing, by name only", () => {
    const s = readZohoConfig({ ZOHO_CLIENT_ID: "x" });
    assert.equal(s.config, null);
    assert.deepEqual(s.missing, ["ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]);
  });

  it("rejects an unknown data centre with a helpful message and honours host overrides", () => {
    assert.match(readZohoConfig({ ...ENV, ZOHO_DC: "mars" }).problem ?? "", /not recognised/);
    const overridden = readZohoConfig({ ...ENV, ZOHO_API_BASE: "http://localhost:9/", ZOHO_ACCOUNTS_BASE: "http://localhost:8" });
    assert.equal(overridden.config?.apiBase, "http://localhost:9");
  });
});

describe("payloads", () => {
  it("formats PO references", () => assert.equal(poReference(7), "FR-PO-000007"));

  it("builds an item with selling price as rate and cost as purchase_rate, dropping unknowns", () => {
    const p = JSON.parse(JSON.stringify(buildItemPayload(sku)));
    assert.equal(p.sku, "SKU016");
    assert.equal(p.rate, 55);
    assert.equal(p.purchase_rate, 40);
    assert.equal(p.item_type, "inventory");
    const bare = JSON.parse(JSON.stringify(buildItemPayload({ ...sku, unitCost: null, unitPrice: null })));
    assert.ok(!("rate" in bare) && !("purchase_rate" in bare));
  });

  it("builds a purchase order tied to its reference, vendor and item", () => {
    const p = buildPurchaseOrderPayload({ poId: 3, skuName: sku.name, unitOfMeasure: "Units", quantity: 500, rate: 40, date: "2026-10-23", overrideReason: null }, "V1", "I1");
    assert.equal(p.reference_number, "FR-PO-000003");
    assert.equal(p.vendor_id, "V1");
    assert.deepEqual(p.line_items[0], { item_id: "I1", name: sku.name, quantity: 500, rate: 40, unit: "Units" });
    const withReason = buildPurchaseOrderPayload({ poId: 3, skuName: "x", unitOfMeasure: "Units", quantity: 1, rate: 1, date: "d", overrideReason: "trimmed lot" }, "V1", "I1");
    assert.match(withReason.notes, /trimmed lot/);
  });

  it("escapes CSV fields containing commas, quotes and newlines", () => {
    assert.equal(csvEscape("plain"), "plain");
    assert.equal(csvEscape('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(csvEscape("a\nb"), '"a\nb"');
    assert.equal(csvEscape(null), "");
  });

  it("exports items and purchase orders with a header row", () => {
    const items = itemsCsv([{ ...sku, onHand: 20, vendorName: "NutriFlow, Ltd", archived: false }, { ...sku, id: "SKU017", name: "Old", onHand: 0, vendorName: null, archived: true }]);
    const lines = items.trim().split("\r\n");
    assert.match(lines[0], /^Item Name,SKU,Unit,Item Type/);
    assert.match(lines[1], /"NutriFlow, Ltd"/);
    assert.match(lines[2], /Inactive$/);
    const pos = purchaseOrdersCsv([{ poId: 2, date: "2026-10-23", vendorName: "V", skuName: "S", skuId: "SKU001", quantity: 10, rate: null, notes: "n", status: "approved" }]);
    assert.match(pos.split("\r\n")[1], /^FR-PO-000002,FR-PO-000002,2026-10-23,V,S,SKU001,10,,n,approved$/);
  });
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const f = (async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: init?.body ? String(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    const text = r.text ?? JSON.stringify(r.json ?? {});
    return new Response(text, { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

const tokenReply = { json: { access_token: "AT", expires_in: 3600 } };

describe("API client", () => {
  beforeEach(() => clearZohoTokenCache());

  it("refreshes the token with the refresh-token grant, then calls the org-scoped endpoint", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes("/oauth/v2/token") ? tokenReply : { json: { code: 0, items: [{ item_id: "9", sku: "sku016" }] } }));
    const found = await createZohoApi(cfg, f).findItemBySku("SKU016");
    assert.deepEqual(found, { item_id: "9", sku: "sku016" }); // sku match is case-insensitive

    assert.equal(calls[0].url, "https://accounts.zoho.in/oauth/v2/token");
    assert.match(calls[0].body ?? "", /grant_type=refresh_token/);
    assert.match(calls[0].body ?? "", /refresh_token=rt/);
    const api = new URL(calls[1].url);
    assert.equal(api.origin + api.pathname, "https://www.zohoapis.in/inventory/v1/items");
    assert.equal(api.searchParams.get("organization_id"), "123");
    assert.equal(api.searchParams.get("sku"), "SKU016");
    assert.equal(calls[1].headers.authorization, "Zoho-oauthtoken AT");
  });

  it("reuses the access token instead of refreshing on every call", async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes("/oauth/v2/token") ? tokenReply : { json: { code: 0, items: [] } }));
    const api = createZohoApi(cfg, f);
    await api.findItemBySku("A");
    await api.findItemBySku("B");
    assert.equal(calls.filter((c) => c.url.includes("/oauth/v2/token")).length, 1);
  });

  it("mints a fresh token and retries once on a 401", async () => {
    let issued = 0;
    const { f, calls } = fakeFetch((c) => {
      if (c.url.includes("/oauth/v2/token")) return { json: { access_token: `AT${++issued}`, expires_in: 3600 } };
      return c.headers.authorization === "Zoho-oauthtoken AT1" ? { status: 401, json: { code: 57, message: "invalid" } } : { json: { code: 0, items: [] } };
    });
    assert.equal(await createZohoApi(cfg, f).findItemBySku("A"), null);
    assert.equal(calls.filter((c) => c.url.includes("/oauth/v2/token")).length, 2);
  });

  it("raises a ZohoError carrying Zoho's message and code when the response says it failed", async () => {
    const { f } = fakeFetch((c) => (c.url.includes("/oauth/v2/token") ? tokenReply : { status: 400, json: { code: 1001, message: "Item name already exists" } }));
    await assert.rejects(() => createZohoApi(cfg, f).createItem({ name: "x" }), (e: unknown) => e instanceof ZohoError && e.code === 1001 && /already exists/.test(e.message));
  });

  it("explains rejected credentials instead of failing obscurely", async () => {
    const { f } = fakeFetch(() => ({ json: { error: "invalid_client" } }));
    await assert.rejects(() => createZohoApi(cfg, f).findItemBySku("A"), /rejected the credentials \(invalid_client\)/);
  });

  it("POSTs JSON for creates and reads the new id", async () => {
    const { f, calls } = fakeFetch((c) =>
      c.url.includes("/oauth/v2/token") ? tokenReply : { json: { code: 0, purchaseorder: { purchaseorder_id: "P1", purchaseorder_number: "PO-00001" } } },
    );
    const po = await createZohoApi(cfg, f).createPurchaseOrder({ reference_number: "FR-PO-000001" });
    assert.deepEqual(po, { purchaseorder_id: "P1", purchaseorder_number: "PO-00001" });
    const post = calls[1];
    assert.equal(post.method, "POST");
    assert.equal(post.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(post.body ?? "{}"), { reference_number: "FR-PO-000001" });
  });

  it("only matches an exact vendor name (search_text is fuzzy)", async () => {
    const { f } = fakeFetch((c) =>
      c.url.includes("/oauth/v2/token") ? tokenReply : { json: { code: 0, contacts: [{ contact_id: "1", contact_name: "NutriFlow Distributors Pvt", contact_type: "vendor" }, { contact_id: "2", contact_name: "NutriFlow Distributors", contact_type: "vendor" }] } },
    );
    assert.deepEqual(await createZohoApi(cfg, f).findVendorByName("nutriflow distributors"), { contact_id: "2", contact_name: "NutriFlow Distributors", contact_type: "vendor" });
  });
});

function fakeApi(over: Partial<ZohoApi> = {}) {
  const log: string[] = [];
  const api: ZohoApi = {
    organizations: async () => [],
    findItemBySku: async () => (log.push("findItem"), null),
    createItem: async () => (log.push("createItem"), { item_id: "I-new" }),
    findVendorByName: async () => (log.push("findVendor"), null),
    createVendor: async () => (log.push("createVendor"), { contact_id: "V-new" }),
    findPurchaseOrderByReference: async () => (log.push("findPO"), null),
    createPurchaseOrder: async () => (log.push("createPO"), { purchaseorder_id: "P-new", purchaseorder_number: "PO-00009" }),
    ...over,
  };
  return { api, log };
}

const input = {
  sku,
  zohoItemId: null,
  vendorName: "NutriFlow Distributors",
  line: { poId: 4, skuName: sku.name, unitOfMeasure: "Units", quantity: 300, rate: 40, date: "2026-10-23", overrideReason: null },
};

describe("pushPurchaseOrder", () => {
  it("creates the item, the vendor and the PO when none exist", async () => {
    const { api, log } = fakeApi();
    const r = await pushPurchaseOrder(api, input);
    assert.deepEqual(log, ["findItem", "createItem", "findVendor", "createVendor", "findPO", "createPO"]);
    assert.deepEqual({ created: r.created, itemCreated: r.itemCreated, po: r.zohoPoNumber }, { created: true, itemCreated: true, po: "PO-00009" });
  });

  it("never duplicates: a PO that already exists in Zoho is linked, not created again", async () => {
    const { api, log } = fakeApi({ findPurchaseOrderByReference: async () => ({ purchaseorder_id: "P-old", purchaseorder_number: "PO-00002" }) });
    const r = await pushPurchaseOrder(api, input);
    assert.ok(!log.includes("createPO"));
    assert.deepEqual({ created: r.created, id: r.zohoPoId }, { created: false, id: "P-old" });
  });

  it("skips the item lookup when the SKU is already linked, and reuses existing vendors and the vendor cache", async () => {
    const { api, log } = fakeApi({ findVendorByName: async () => (log.push("findVendor"), { contact_id: "V-old" }) });
    const cache = new Map<string, string>();
    await pushPurchaseOrder(api, { ...input, zohoItemId: "I-linked" }, cache);
    await pushPurchaseOrder(api, { ...input, zohoItemId: "I-linked", line: { ...input.line, poId: 5 } }, cache);
    assert.ok(!log.includes("findItem") && !log.includes("createVendor"));
    assert.equal(log.filter((l) => l === "findVendor").length, 1); // second PO hits the cache
  });

  it("refuses a PO whose SKU has no distributor, before calling Zoho", async () => {
    const { api, log } = fakeApi();
    await assert.rejects(() => pushPurchaseOrder(api, { ...input, vendorName: null }), /no distributor/);
    assert.deepEqual(log, []);
  });

  it("links an item that already exists by SKU instead of creating it", async () => {
    const { api, log } = fakeApi({ findItemBySku: async () => ({ item_id: "I-existing" }) });
    assert.deepEqual(await ensureItem(api, sku), { itemId: "I-existing", created: false });
    assert.ok(!log.includes("createItem"));
  });
});
