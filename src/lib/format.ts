const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** ₹1,23,456 */
export function formatINR(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${inr.format(Math.abs(Math.round(value)))}`;
}

/** Indian compact notation: ₹12.4K, ₹3.20 L (lakh), ₹1.10 Cr (crore). */
export function formatINRCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return digits === 0 ? inr.format(Math.round(value)) : num1.format(Number(value.toFixed(digits)));
}

export function formatWeeks(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} wk`;
}

/** 0.213 -> "+21.3%" */
export function formatPctDelta(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}
