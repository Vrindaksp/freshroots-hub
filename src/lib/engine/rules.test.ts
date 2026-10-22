import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSku, type SkuInput } from "./rules";

const flat = (units: number, weeks = 12) => Array.from({ length: weeks }, () => units);

function sku(overrides: Partial<SkuInput> = {}): SkuInput {
  return {
    skuId: "T1",
    name: "Test SKU",
    perishable: false,
    minStockWeeks: 3,
    maxStockWeeks: 4,
    standardOrderQty: 100,
    unitCost: 10,
    onHand: 1000, // 10 weeks of a flat 100/wk
    openPoUnits: 0,
    weekly: flat(100),
    uplift: 0,
    ...overrides,
  };
}

describe("rolling averages", () => {
  it("computes 4-week and 12-week means from complete weeks", () => {
    const e = evaluateSku(sku({ weekly: [...flat(100, 8), 120, 120, 120, 120] }));
    assert.equal(e.avg4, 120);
    assert.ok(Math.abs(e.avg12 - 106.666) < 0.01);
  });
});

describe("high-demand rule", () => {
  it("does not flag a rise of exactly 20%", () => {
    // 4w avg 120 vs 12w avg 100 needs the other 8 weeks at 90 → (8*90 + 4*120)/12 = 100
    const e = evaluateSku(sku({ weekly: [...flat(90, 8), ...flat(120, 4)] }));
    assert.ok(Math.abs(e.avg4 / e.avg12 - 1.2) < 1e-9);
    assert.ok(!e.flags.includes("HIGH_DEMAND"));
  });

  it("flags above 20% and recommends 1.5x the standard quantity", () => {
    const e = evaluateSku(sku({ weekly: [...flat(90, 8), ...flat(125, 4)], standardOrderQty: 200 }));
    assert.ok(e.flags.includes("HIGH_DEMAND"));
    assert.equal(e.action, "reorder");
    assert.equal(e.recommendedQty, 300);
  });
});

describe("stockout rule", () => {
  it("recommends a reorder below 6 weeks of cover", () => {
    const e = evaluateSku(sku({ onHand: 500 })); // 5 weeks
    assert.ok(e.flags.includes("STOCKOUT_RISK"));
    assert.equal(e.action, "reorder");
    assert.equal(e.recommendedQty, 100);
  });

  it("does not flag at exactly 6 weeks", () => {
    const e = evaluateSku(sku({ onHand: 600 }));
    assert.ok(!e.flags.includes("STOCKOUT_RISK"));
    assert.equal(e.action, "hold");
  });

  it("adds standard lots until the minimum cover is restored", () => {
    const e = evaluateSku(sku({ onHand: 100 })); // 1 week; needs 500 more to reach 6 weeks
    assert.equal(e.recommendedQty, 500);
  });

  it("does not add a lot for a gap within 5% of the minimum", () => {
    // 6-week minimum = 600 units; 1 lot of 100 on top of 495 = 595, within 5% of 600
    const e = evaluateSku(sku({ onHand: 495 }));
    assert.equal(e.recommendedQty, 100);
  });

  it("treats an open PO that lands within 5% of the minimum as covering the shortfall", () => {
    // Planner trimmed a 750 order to 700: 900 + 700 = 1,600 vs a 1,611.6 minimum must not trigger a duplicate order
    const e = evaluateSku(sku({ onHand: 900, openPoUnits: 700, weekly: flat(214.9, 12), uplift: 0.25 }));
    assert.ok(e.flags.includes("COVERED_BY_OPEN_PO"));
    assert.equal(e.action, "hold");
  });

  it("holds when open purchase orders already restore cover", () => {
    const e = evaluateSku(sku({ onHand: 300, openPoUnits: 400 }));
    assert.ok(e.flags.includes("STOCKOUT_RISK"));
    assert.ok(e.flags.includes("COVERED_BY_OPEN_PO"));
    assert.equal(e.action, "hold");
    assert.equal(e.recommendedQty, 0);
  });
});

describe("overstock rule", () => {
  it("pauses orders above 14 weeks", () => {
    const e = evaluateSku(sku({ onHand: 1500 }));
    assert.ok(e.flags.includes("OVERSTOCK_RISK"));
    assert.equal(e.action, "pause");
    assert.equal(e.recommendedQty, 0);
  });

  it("overrides the high-demand signal", () => {
    const e = evaluateSku(sku({ onHand: 5000, weekly: [...flat(90, 8), ...flat(130, 4)] }));
    assert.ok(e.flags.includes("HIGH_DEMAND"));
    assert.equal(e.action, "pause");
  });
});

describe("seasonality lift", () => {
  it("applies +25% to demand before threshold checks", () => {
    // 700 on hand = 7 weeks at 100/wk (healthy) but 5.6 weeks at 125/wk (stockout risk)
    const plain = evaluateSku(sku({ onHand: 700 }));
    const festival = evaluateSku(sku({ onHand: 700, uplift: 0.25 }));
    assert.ok(!plain.flags.includes("STOCKOUT_RISK"));
    assert.ok(festival.flags.includes("STOCKOUT_RISK"));
    assert.ok(festival.flags.includes("SEASONAL_UPLIFT"));
    assert.equal(festival.effectiveWeeklyDemand, 125);
  });
});

describe("perishability window", () => {
  it("enforces a 3-4 week window instead of 6/14", () => {
    // 5 weeks of cover is a stockout-free, healthy position for non-perishables, but above the perishable ceiling
    const p = evaluateSku(sku({ perishable: true, onHand: 500 }));
    assert.ok(p.flags.includes("OVERSTOCK_RISK"));
    assert.ok(p.flags.includes("PERISHABLE_WINDOW"));
    assert.equal(p.action, "pause");
  });

  it("reorders below 3 weeks and never overshoots the 4-week ceiling", () => {
    const p = evaluateSku(sku({ perishable: true, onHand: 150, standardOrderQty: 500 }));
    assert.ok(p.flags.includes("STOCKOUT_RISK"));
    assert.equal(p.action, "reorder");
    // ceiling is 400 units, 150 on hand → at most 250, not a full 500 lot
    assert.equal(p.recommendedQty, 250);
    assert.ok((150 + p.recommendedQty) / p.effectiveWeeklyDemand <= 4 + 1e-9);
  });

  it("stays quiet inside the window", () => {
    const p = evaluateSku(sku({ perishable: true, onHand: 350 }));
    assert.equal(p.action, "hold");
    assert.deepEqual(p.flags, []);
  });
});

describe("edge-case detection", () => {
  it("marks a short history as a new launch", () => {
    const e = evaluateSku(sku({ weekly: [10, 40, 80, 90, 95] }));
    assert.ok(e.edgeReasons.includes("NEW_LAUNCH"));
    assert.ok(e.isEdgeCase);
  });

  it("marks a sudden demand shift", () => {
    const e = evaluateSku(sku({ weekly: [...flat(100, 8), ...flat(160, 4)] }));
    assert.ok(e.edgeReasons.includes("DEMAND_SHIFT"));
  });

  it("marks a pause that contradicts a rising trend", () => {
    const e = evaluateSku(sku({ perishable: true, onHand: 600, weekly: [...flat(100, 8), ...flat(115, 4)] }));
    assert.equal(e.action, "pause");
    assert.ok(e.edgeReasons.includes("SIGNAL_CONFLICT"));
  });

  it("marks multi-lot shortfall orders", () => {
    const e = evaluateSku(sku({ onHand: 200 })); // needs 400 = 4 lots
    assert.ok(e.edgeReasons.includes("DEEP_SHORTFALL"));
  });

  it("leaves steady healthy SKUs alone", () => {
    const e = evaluateSku(sku());
    assert.equal(e.isEdgeCase, false);
  });
});

describe("empty demand", () => {
  it("holds without crashing when there are no sales", () => {
    const e = evaluateSku(sku({ weekly: flat(0) }));
    assert.equal(e.action, "hold");
    assert.equal(e.coverWeeks, null);
  });
});
