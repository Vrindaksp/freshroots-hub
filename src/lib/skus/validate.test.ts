import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSkuId, validateSkuInput, type SkuFormInput } from "./validate";

const ctx = { existingIds: ["SKU001", "SKU015"], distributorIds: ["DIST001", "DIST002"], mode: "add" as const };
const good: SkuFormInput = {
  name: "Freshroots Jaggery 500g",
  category: "Staple",
  perishability: "Low",
  standardOrderQty: "120",
  distributorId: "DIST002",
};

describe("nextSkuId", () => {
  it("continues after the highest SKU number", () => {
    assert.equal(nextSkuId(["SKU001", "SKU015", "SKU003"]), "SKU016");
  });
  it("starts at SKU001 and ignores other id styles", () => {
    assert.equal(nextSkuId([]), "SKU001");
    assert.equal(nextSkuId(["CUSTOM-1", "abc"]), "SKU001");
  });
  it("is case-insensitive and pads to three digits", () => {
    assert.equal(nextSkuId(["sku009"]), "SKU010");
    assert.equal(nextSkuId(["SKU999"]), "SKU1000");
  });
});

describe("validateSkuInput (add)", () => {
  it("accepts a minimal valid SKU and auto-generates the id", () => {
    const r = validateSkuInput(good, ctx);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.id, "SKU016");
      assert.equal(r.value.standardOrderQty, 120);
      assert.equal(r.value.unitOfMeasure, "Units");
      assert.equal(r.value.openingStock, 0);
      assert.equal(r.value.unitCost, null);
    }
  });

  it("accepts optional cost, price, opening stock and location", () => {
    const r = validateSkuInput({ ...good, unitCost: "1,250.50", unitPrice: 1500, openingStock: "300", location: " Pune Central Warehouse " }, ctx);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.unitCost, 1250.5);
      assert.equal(r.value.openingStock, 300);
      assert.equal(r.value.location, "Pune Central Warehouse");
    }
  });

  it("rejects a duplicate id case-insensitively, including removed SKUs", () => {
    const r = validateSkuInput({ ...good, id: "sku015" }, ctx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.id, /already exists/);
  });

  it("rejects bad ids, names, quantities and unknown distributors with field-level errors", () => {
    const r = validateSkuInput(
      { id: "bad id!", name: "x", category: "", perishability: "Medium", standardOrderQty: "1.5", distributorId: "DIST999", unitCost: "-3", openingStock: "-1" },
      ctx,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      for (const field of ["id", "name", "category", "perishability", "standardOrderQty", "distributorId", "unitCost", "openingStock"]) {
        assert.ok(r.errors[field], `expected an error for ${field}`);
      }
    }
  });

  it("requires a distributor and a whole-number quantity of at least 1", () => {
    const r = validateSkuInput({ ...good, distributorId: "", standardOrderQty: 0 }, ctx);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors.distributorId);
      assert.ok(r.errors.standardOrderQty);
    }
  });

  it("treats blank optional numbers as empty, not zero", () => {
    const r = validateSkuInput({ ...good, unitCost: "", unitPrice: "  ", openingStock: "" }, ctx);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.unitCost, null);
      assert.equal(r.value.unitPrice, null);
    }
  });
});

describe("validateSkuInput (edit)", () => {
  it("keeps the fixed id and does not collide with itself", () => {
    const r = validateSkuInput({ ...good, id: "IGNORED" }, { ...ctx, mode: "edit", fixedId: "SKU015" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.id, "SKU015");
  });
});
