import { FLAG_LABELS, type Flag } from "@/lib/engine/config";
import { Badge, type Tone } from "./ui";

export const FLAG_TONE: Record<Flag, Tone> = {
  HIGH_DEMAND: "accent",
  STOCKOUT_RISK: "crit",
  OVERSTOCK_RISK: "warn",
  PERISHABLE_WINDOW: "info",
  COVERED_BY_OPEN_PO: "ok",
  SEASONAL_UPLIFT: "neutral",
};

const FLAG_HINT: Partial<Record<Flag, string>> = {
  HIGH_DEMAND: "4-week average is more than 20% above the 12-week average",
  STOCKOUT_RISK: "Stock cover is below the minimum (6 weeks, or 3 for perishables)",
  OVERSTOCK_RISK: "Stock cover is above the maximum (14 weeks, or 4 for perishables) — orders paused",
  PERISHABLE_WINDOW: "High-perishability SKU outside its strict 3–4 week window",
  COVERED_BY_OPEN_PO: "Open purchase orders already restore cover",
  SEASONAL_UPLIFT: "Festival month: +25% demand uplift applied",
};

export function FlagBadges({ flags, hide = [] }: { flags: Flag[]; hide?: Flag[] }) {
  const visible = flags.filter((f) => !hide.includes(f));
  if (!visible.length) return <span className="text-xs text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {visible.map((f) => (
        <Badge key={f} tone={FLAG_TONE[f]} icon={FLAG_TONE[f] === "crit" || FLAG_TONE[f] === "warn"} title={FLAG_HINT[f]}>
          {FLAG_LABELS[f]}
        </Badge>
      ))}
    </span>
  );
}

export function ActionBadge({ action }: { action: "reorder" | "pause" | "hold" }) {
  if (action === "reorder") return <Badge tone="accent">Reorder</Badge>;
  if (action === "pause") return <Badge tone="warn">Pause orders</Badge>;
  return <Badge tone="neutral">Hold</Badge>;
}
