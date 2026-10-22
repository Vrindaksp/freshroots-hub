import { DEFAULT_CONFIG, type EdgeReason, type EngineConfig, type Flag } from "./config";

/**
 * The demand-planning rule engine. Pure functions only: no database, no clock, no network.
 *
 * Order of evaluation for one SKU:
 *   1. Rolling averages: 4-week vs 12-week from complete weeks of sales.
 *   2. Festival uplift (+25%) is applied to the 12-week baseline BEFORE any threshold check.
 *   3. Cover = on-hand units / uplifted weekly demand.
 *   4. Thresholds — non-perishable: reorder < 6 wk, pause > 14 wk.
 *                   high-perishability: strict 3–4 wk window (reorder < 3, pause > 4).
 *   5. HIGH_DEMAND (4-wk avg > 12-wk avg by more than 20%) recommends 1.5x the standard quantity.
 *   6. Order quantity is capped so stock + open orders never exceed the ceiling of the SKU's window.
 *   7. SKUs where the rules are least trustworthy are marked as edge cases for Gemini review.
 */

export interface SkuInput {
  skuId: string;
  name: string;
  perishable: boolean;
  minStockWeeks: number;
  maxStockWeeks: number;
  standardOrderQty: number;
  unitCost: number | null;
  onHand: number;
  /** Units already on order: external open POs plus approved POs not yet in the stock snapshot. */
  openPoUnits: number;
  /** Complete weeks of units sold, oldest → newest. */
  weekly: number[];
  /** 0 outside festival months, 0.25 inside them. */
  uplift: number;
}

export type Action = "reorder" | "pause" | "hold";

export interface SkuEvaluation {
  skuId: string;
  avg4: number;
  avg12: number;
  /** avg4 / avg12 - 1 */
  trend: number;
  cv12: number;
  historyWeeks: number;
  effectiveWeeklyDemand: number;
  coverWeeks: number | null;
  /** (on hand + open orders) / demand */
  positionWeeks: number | null;
  lowWeeks: number;
  highWeeks: number;
  flags: Flag[];
  action: Action;
  recommendedQty: number;
  estValue: number | null;
  rationale: string[];
  isEdgeCase: boolean;
  edgeReasons: EdgeReason[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m <= 0 || xs.length < 2) return 0;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance) / m;
}

const f1 = (n: number) => n.toFixed(1);
const fInt = (n: number) => Math.round(n).toLocaleString("en-IN");

export function evaluateSku(input: SkuInput, config: EngineConfig = DEFAULT_CONFIG): SkuEvaluation {
  const { weekly, uplift } = input;
  const n = weekly.length;
  const avg4 = mean(weekly.slice(-4));
  const avg12 = mean(weekly.slice(-12));
  const trend = avg12 > 0 ? avg4 / avg12 - 1 : 0;
  const cv12 = coefficientOfVariation(weekly.slice(-12));

  const effective = avg12 * (1 + uplift);
  const cover = effective > 0 ? input.onHand / effective : null;
  const position = input.onHand + input.openPoUnits;
  const positionWeeks = effective > 0 ? position / effective : null;

  const lowWeeks = input.perishable ? input.minStockWeeks : config.stockoutWeeks;
  const highWeeks = input.perishable ? input.maxStockWeeks : config.overstockWeeks;
  const lowUnits = lowWeeks * effective;
  const capUnits = highWeeks * effective;
  const std = input.standardOrderQty;

  const flags: Flag[] = [];
  const rationale: string[] = [];

  if (uplift > 0) {
    rationale.push(
      `Festival month: +${Math.round(uplift * 100)}% demand uplift applied before thresholds (${f1(avg12)} → ${f1(effective)} units/wk).`,
    );
  }

  const highDemand = avg12 > 0 && avg4 > avg12 * (1 + config.highDemandThreshold);
  if (highDemand) {
    flags.push("HIGH_DEMAND");
    rationale.push(
      `4-week average ${f1(avg4)} is ${(trend * 100).toFixed(1)}% above the 12-week average ${f1(avg12)} (threshold +${Math.round(config.highDemandThreshold * 100)}%).`,
    );
  }

  const stockout = cover != null && cover < lowWeeks;
  const overstock = cover != null && cover > highWeeks;
  const windowLabel = input.perishable
    ? `${lowWeeks}–${highWeeks} week perishable window`
    : `${lowWeeks}-week reorder / ${highWeeks}-week pause thresholds`;

  if (stockout) {
    flags.push("STOCKOUT_RISK");
    rationale.push(`Stock covers ${f1(cover!)} weeks of demand, below the ${lowWeeks}-week minimum (${windowLabel}).`);
  }
  if (overstock) {
    flags.push("OVERSTOCK_RISK");
    rationale.push(`Stock covers ${f1(cover!)} weeks of demand, above the ${highWeeks}-week maximum (${windowLabel}).`);
  }
  if (input.perishable && (stockout || overstock)) flags.push("PERISHABLE_WINDOW");

  let action: Action = "hold";
  let qty = 0;

  if (effective <= 0) {
    rationale.push("No sales in the lookback window — nothing to plan against.");
  } else if (overstock) {
    action = "pause";
    rationale.push(
      highDemand
        ? "Orders paused: overstock overrides the high-demand signal."
        : "Orders paused until cover falls back inside the window.",
    );
  } else if (stockout && position >= lowUnits * config.restoreTolerance) {
    flags.push("COVERED_BY_OPEN_PO");
    rationale.push(
      `${fInt(input.openPoUnits)} units already on order lift cover to ${f1(positionWeeks!)} weeks — no new order needed.`,
    );
  } else if (stockout || highDemand) {
    const lots = highDemand ? config.highDemandOrderMultiplier : 1;
    qty = Math.round(std * lots);
    rationale.push(
      highDemand
        ? `Reorder at ${lots}× standard quantity (${fInt(std)} → ${fInt(qty)}).`
        : `Reorder one standard lot (${fInt(std)} units).`,
    );
    if (stockout) {
      let extraLots = 0;
      while (position + qty < lowUnits * config.restoreTolerance && position + qty + std <= capUnits) {
        qty += std;
        extraLots++;
      }
      if (extraLots > 0) {
        rationale.push(`Added ${extraLots} extra standard lot${extraLots > 1 ? "s" : ""} so the order restores the ${lowWeeks}-week minimum.`);
      }
    }
    const headroom = Math.floor(capUnits - position);
    if (qty > headroom) {
      rationale.push(
        `Capped at ${fInt(Math.max(0, headroom))} units so stock plus open orders stays within ${highWeeks} weeks of demand.`,
      );
      qty = Math.max(0, headroom);
    }
    if (qty > 0) {
      action = "reorder";
      const after = (position + qty) / effective;
      rationale.push(`Cover after this order: ${f1(after)} weeks.`);
    } else {
      qty = 0;
      rationale.push("No headroom for an order inside the maximum cover.");
    }
  } else {
    rationale.push(`Cover of ${f1(cover!)} weeks sits inside the healthy range — no action.`);
  }

  if (uplift > 0) flags.push("SEASONAL_UPLIFT");

  // Edge cases: the SKUs where a fixed rule is least reliable → Gemini commentary for Raghav.
  const edgeReasons: EdgeReason[] = [];
  if (n < config.newLaunchWeeks) edgeReasons.push("NEW_LAUNCH");
  if (Math.abs(trend) > config.edgeShiftPct) edgeReasons.push("DEMAND_SHIFT");
  if (cv12 > config.edgeVolatilityCv) edgeReasons.push("VOLATILE");
  if (
    (action === "pause" && trend >= config.edgeConflictTrend) ||
    (action === "reorder" && trend <= -config.edgeConflictTrend)
  ) {
    edgeReasons.push("SIGNAL_CONFLICT");
  }
  if (action === "reorder" && qty >= std * config.edgeDeepShortfallLots) edgeReasons.push("DEEP_SHORTFALL");

  return {
    skuId: input.skuId,
    avg4,
    avg12,
    trend,
    cv12,
    historyWeeks: n,
    effectiveWeeklyDemand: effective,
    coverWeeks: cover,
    positionWeeks,
    lowWeeks,
    highWeeks,
    flags,
    action,
    recommendedQty: qty,
    estValue: input.unitCost != null ? qty * input.unitCost : null,
    rationale,
    isEdgeCase: edgeReasons.length > 0,
    edgeReasons,
  };
}
