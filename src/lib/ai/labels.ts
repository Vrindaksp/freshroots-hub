/** Client-safe labels for Gemini output (no server imports, so it can be bundled into the browser). */
export const RECOMMENDATION_LABEL = {
  accept_rule_quantity: "Accept rule quantity",
  increase_quantity: "Increase quantity",
  reduce_quantity: "Reduce quantity",
  hold_order: "Hold the order",
  investigate_first: "Investigate first",
} as const;

export const NOTE_TYPE_LABEL: Record<string, string> = {
  demand_up: "Demand up",
  demand_down: "Demand down",
  supply_delay: "Supply delay",
  promotion: "Promotion",
  quality_issue: "Quality issue",
  price_change: "Price change",
  other: "Other",
};
