/** Business rules from the Freshroots brief. Change them here — nothing else hard-codes a threshold. */
export interface EngineConfig {
  /** 4-week average must exceed the 12-week average by more than this ratio to flag HIGH_DEMAND. */
  highDemandThreshold: number;
  /** Reorder multiplier on the standard quantity when HIGH_DEMAND fires. */
  highDemandOrderMultiplier: number;
  /** Non-perishable: reorder when stock covers fewer than this many weeks of demand. */
  stockoutWeeks: number;
  /** Non-perishable: pause orders when stock covers more than this many weeks of demand. */
  overstockWeeks: number;
  /** Demand uplift applied in festival months, before any threshold check. */
  festivalUplift: number;
  /** Fallback when the calendar table has no row for the as-of month. */
  festivalMonths: number[];
  /** Extra standard lots are only added while cover is below this share of the minimum (0.95 = within 5%). */
  restoreTolerance: number;
  /** Weeks of history needed before a SKU stops counting as a new launch. */
  newLaunchWeeks: number;
  /** |4w/12w - 1| above this routes the SKU to Gemini as a demand-shift edge case. */
  edgeShiftPct: number;
  /** Coefficient of variation (12 weeks) above this routes the SKU to Gemini. */
  edgeVolatilityCv: number;
  /** When a rule action contradicts a trend of at least this size, the SKU is an edge case. */
  edgeConflictTrend: number;
  /** Recommended order of at least this many standard lots signals a deep shortfall. */
  edgeDeepShortfallLots: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  highDemandThreshold: 0.2,
  highDemandOrderMultiplier: 1.5,
  stockoutWeeks: 6,
  overstockWeeks: 14,
  festivalUplift: 0.25,
  festivalMonths: [10, 11, 3],
  restoreTolerance: 0.95,
  newLaunchWeeks: 8,
  edgeShiftPct: 0.2,
  edgeVolatilityCv: 0.3,
  edgeConflictTrend: 0.08,
  edgeDeepShortfallLots: 2,
};

/**
 * Assumptions behind the rupee impact figures shown to executives. They are estimates, not accounting:
 * tune them against finance's actual write-off and lost-sale history.
 */
export const IMPACT_ASSUMPTIONS = {
  /** Share of a projected unit shortfall that turns into lost sales. */
  stockoutRealisation: 0.6,
  /** Share of excess stock (above the max cover cap) written off. */
  overstockWriteOffPerishable: 0.5,
  overstockWriteOffNonPerishable: 0.1,
  /** Quarterly planning-error baseline from the brief (₹ lakh): 18–22 stockout + 10–12 overstock. */
  quarterlyBaselineLakh: { low: 28, high: 34 },
} as const;

export type Flag =
  | "HIGH_DEMAND"
  | "STOCKOUT_RISK"
  | "OVERSTOCK_RISK"
  | "SEASONAL_UPLIFT"
  | "PERISHABLE_WINDOW"
  | "COVERED_BY_OPEN_PO";

export const FLAG_LABELS: Record<Flag, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
  SEASONAL_UPLIFT: "Festival uplift",
  PERISHABLE_WINDOW: "Perishable window",
  COVERED_BY_OPEN_PO: "Covered by open PO",
};

export type EdgeReason =
  | "NEW_LAUNCH"
  | "DEMAND_SHIFT"
  | "VOLATILE"
  | "SIGNAL_CONFLICT"
  | "DEEP_SHORTFALL";

export const EDGE_LABELS: Record<EdgeReason, string> = {
  NEW_LAUNCH: "New launch (short history)",
  DEMAND_SHIFT: "Sudden demand shift",
  VOLATILE: "Volatile weekly sales",
  SIGNAL_CONFLICT: "Rules contradict demand trend",
  DEEP_SHORTFALL: "Multi-lot shortfall",
};
