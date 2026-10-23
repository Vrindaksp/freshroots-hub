/** Pure builders for what we send to Zoho and what we export for Zoho's import wizard. */

export const poReference = (poId: number): string => `FR-PO-${String(poId).padStart(6, "0")}`;

export interface ItemSource {
  id: string;
  name: string;
  category: string;
  perishable: boolean;
  unitOfMeasure: string;
  unitCost: number | null;
  unitPrice: number | null;
}

/** Zoho Inventory "create item": rate = selling price, purchase_rate = cost. Undefined keys are dropped by JSON.stringify. */
export function buildItemPayload(s: ItemSource) {
  return {
    name: s.name,
    sku: s.id,
    unit: s.unitOfMeasure,
    item_type: "inventory",
    product_type: "goods",
    rate: s.unitPrice ?? undefined,
    purchase_rate: s.unitCost ?? undefined,
    description: `${s.category}${s.perishable ? " · high perishability" : ""} · created from the Freshroots hub`,
  };
}

export interface PoLineSource {
  poId: number;
  skuName: string;
  unitOfMeasure: string;
  quantity: number;
  /** Unit cost; 0 when unknown (the preview warns about it). */
  rate: number;
  date: string;
  overrideReason: string | null;
}

/** Zoho Inventory "create purchase order". Created as a draft in Zoho so a person still issues it there. */
export function buildPurchaseOrderPayload(line: PoLineSource, vendorId: string, itemId: string) {
  return {
    vendor_id: vendorId,
    reference_number: poReference(line.poId),
    date: line.date,
    line_items: [{ item_id: itemId, name: line.skuName, quantity: line.quantity, rate: line.rate, unit: line.unitOfMeasure }],
    notes: line.overrideReason ? `Approved with override in the Freshroots hub: ${line.overrideReason}` : "Approved in the Freshroots hub",
  };
}

export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export interface ItemCsvRow extends ItemSource {
  onHand: number;
  vendorName: string | null;
  archived: boolean;
}

/** Item list for Zoho's "Import items" wizard. Column names follow Zoho's field names; the wizard lets you re-map any that differ. */
export function itemsCsv(rows: ItemCsvRow[]): string {
  return toCsv(
    ["Item Name", "SKU", "Unit", "Item Type", "Product Type", "Selling Price", "Purchase Price", "Opening Stock", "Preferred Vendor", "Category", "Status"],
    rows.map((r) => [r.name, r.id, r.unitOfMeasure, "Inventory", "Goods", r.unitPrice, r.unitCost, r.onHand, r.vendorName, r.category, r.archived ? "Inactive" : "Active"]),
  );
}

export interface PoCsvRow {
  poId: number;
  date: string;
  vendorName: string | null;
  skuName: string;
  skuId: string;
  quantity: number;
  rate: number | null;
  notes: string;
  status: string;
}

export function purchaseOrdersCsv(rows: PoCsvRow[]): string {
  return toCsv(
    ["Purchase Order Number", "Reference#", "Purchase Order Date", "Vendor Name", "Item Name", "SKU", "Quantity", "Item Price", "Notes", "Status"],
    rows.map((r) => [poReference(r.poId), poReference(r.poId), r.date, r.vendorName, r.skuName, r.skuId, r.quantity, r.rate, r.notes, r.status]),
  );
}
