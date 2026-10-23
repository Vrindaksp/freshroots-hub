/**
 * Validation for manually added/edited SKUs. Pure (no database) so it is unit-tested and shared by the form and the server.
 */

export interface SkuFormInput {
  /** Leave empty to auto-generate the next SKU number. Ignored when editing. */
  id?: string;
  name: string;
  category: string;
  perishability: "High" | "Low" | string;
  standardOrderQty: number | string;
  unitOfMeasure?: string;
  distributorId: string;
  unitCost?: number | string | null;
  unitPrice?: number | string | null;
  /** Units on hand to record when the SKU is created. */
  openingStock?: number | string | null;
  /** Warehouse the opening stock is in. */
  location?: string;
}

export interface CleanSku {
  id: string;
  name: string;
  category: string;
  perishability: "High" | "Low";
  standardOrderQty: number;
  unitOfMeasure: string;
  distributorId: string;
  unitCost: number | null;
  unitPrice: number | null;
  openingStock: number;
  location: string | null;
}

export type SkuValidation = { ok: true; value: CleanSku } | { ok: false; errors: Record<string, string> };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$/;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Next free `SKU###` after the highest existing number (SKU015 → SKU016). Other id styles are ignored. */
export function nextSkuId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^SKU(\d+)$/i.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SKU${String(max + 1).padStart(3, "0")}`;
}

export function validateSkuInput(
  raw: SkuFormInput,
  ctx: { existingIds: string[]; distributorIds: string[]; mode: "add" | "edit"; fixedId?: string },
): SkuValidation {
  const errors: Record<string, string> = {};

  const name = (raw.name ?? "").trim();
  if (name.length < 2 || name.length > 120) errors.name = "Name must be 2–120 characters.";

  const category = (raw.category ?? "").trim();
  if (category.length < 2 || category.length > 40) errors.category = "Category must be 2–40 characters.";

  const perishability = /^high$/i.test(String(raw.perishability)) ? "High" : /^low$/i.test(String(raw.perishability)) ? "Low" : null;
  if (!perishability) errors.perishability = "Choose High or Low perishability.";

  const std = toNumber(raw.standardOrderQty);
  if (std === null || Number.isNaN(std) || !Number.isInteger(std) || std < 1 || std > 1_000_000) {
    errors.standardOrderQty = "Standard order quantity must be a whole number from 1 to 1,000,000.";
  }

  const uom = (raw.unitOfMeasure ?? "").trim() || "Units";
  if (uom.length > 20) errors.unitOfMeasure = "Unit of measure is too long (max 20 characters).";

  const distributorId = (raw.distributorId ?? "").trim();
  if (!distributorId) errors.distributorId = "Choose the distributor this SKU is supplied through.";
  else if (!ctx.distributorIds.includes(distributorId)) errors.distributorId = "That distributor does not exist.";

  const cost = toNumber(raw.unitCost);
  if (Number.isNaN(cost) || (cost !== null && (cost < 0 || cost > 10_000_000))) errors.unitCost = "Unit cost must be a number of 0 or more.";
  const price = toNumber(raw.unitPrice);
  if (Number.isNaN(price) || (price !== null && (price < 0 || price > 10_000_000))) errors.unitPrice = "Unit price must be a number of 0 or more.";

  let id = ctx.mode === "edit" ? (ctx.fixedId ?? "") : (raw.id ?? "").trim();
  if (ctx.mode === "add") {
    if (!id) id = nextSkuId(ctx.existingIds);
    else if (!ID_PATTERN.test(id)) errors.id = "SKU ID may use letters, numbers, - and _ (2–24 characters, starting with a letter or number).";
    else if (ctx.existingIds.some((e) => e.toLowerCase() === id.toLowerCase())) errors.id = `${id} already exists (it may be a removed SKU — restore it instead).`;
  }

  const stock = toNumber(raw.openingStock);
  if (ctx.mode === "add" && stock !== null && (Number.isNaN(stock) || !Number.isInteger(stock) || stock < 0 || stock > 100_000_000)) {
    errors.openingStock = "Opening stock must be a whole number of 0 or more.";
  }
  const location = (raw.location ?? "").trim();
  if (location.length > 80) errors.location = "Location is too long (max 80 characters).";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      name,
      category,
      perishability: perishability!,
      standardOrderQty: std as number,
      unitOfMeasure: uom,
      distributorId,
      unitCost: cost,
      unitPrice: price,
      openingStock: stock ?? 0,
      location: location || null,
    },
  };
}
