import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METRIC_BY_NAME } from "../metrics/registry";
import { detectMetricDeviation, detectRegionalDeviations, elapsedFraction } from "./detect";

const weeks = (units: number[]) => units.map((u, i) => ({ week: `W${i}`, units: u }));

describe("elapsedFraction", () => {
  it("is 1 for a complete week and grows through the week", () => {
    assert.equal(elapsedFraction("2026-10-12", "2026-10-18"), 1);
    const wed = elapsedFraction("2026-10-12", "2026-10-14");
    const thu = elapsedFraction("2026-10-12", "2026-10-15");
    assert.ok(wed > 0.4 && wed < 0.6);
    assert.ok(thu > wed);
  });
});

describe("regional deviations", () => {
  const base = [1000, 1020, 980, 1000];

  it("flags a >15% order drop in a complete week", () => {
    const alerts = detectRegionalDeviations([
      { region: "Goa", series: weeks([...base, 800]), elapsed: 1, lastDate: "2026-10-18" },
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "REGIONAL_DROP");
    assert.equal(alerts[0].severity, "warning");
  });

  it("flags a mid-week drop by pro-rating the baseline", () => {
    // By Wednesday ~50% of the week's orders should be in (~500). 340 is 32% under pace → critical.
    const elapsed = elapsedFraction("2026-10-12", "2026-10-14");
    const alerts = detectRegionalDeviations([
      { region: "Nagpur", series: weeks([...base, 340]), elapsed, lastDate: "2026-10-14" },
    ]);
    assert.equal(alerts[0].type, "REGIONAL_DROP");
    assert.equal(alerts[0].severity, "critical");
    assert.equal(alerts[0].details.partialWeek, true);
  });

  it("stays quiet at exactly the pace and for a 14% dip", () => {
    const quiet = detectRegionalDeviations([
      { region: "A", series: weeks([...base, 1000]), elapsed: 1, lastDate: "2026-10-18" },
      { region: "B", series: weeks([...base, 860]), elapsed: 1, lastDate: "2026-10-18" },
    ]);
    assert.equal(quiet.length, 0);
  });

  it("reports a large surge as info", () => {
    const alerts = detectRegionalDeviations([
      { region: "Pune", series: weeks([...base, 1300]), elapsed: 1, lastDate: "2026-10-18" },
    ]);
    assert.equal(alerts[0].type, "REGIONAL_SURGE");
    assert.equal(alerts[0].severity, "info");
  });
});

describe("metric deviations", () => {
  const series = (values: number[]) => values.map((value, i) => ({ at: `2026-09-${10 + i}`, value }));

  it("flags a fulfillment drop of 3+ points", () => {
    const def = METRIC_BY_NAME.get("order_fulfillment_rate")!;
    const a = detectMetricDeviation(def, series([96, 96.5, 95.8, 96.2, 92.0]), "feed");
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, "warning");
  });

  it("flags a complaint spike and ignores a decline", () => {
    const def = METRIC_BY_NAME.get("distributor_complaints")!;
    assert.equal(detectMetricDeviation(def, series([9, 10, 8, 9, 15]), "feed")[0].severity, "warning");
    assert.equal(detectMetricDeviation(def, series([9, 10, 8, 9, 4]), "feed").length, 0);
  });
});
