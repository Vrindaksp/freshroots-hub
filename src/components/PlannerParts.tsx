import { addDays, shortDate } from "@/lib/dates";

/**
 * Weeks of cover against the SKU's healthy window. The shaded band is the window (6–14 wk, or 3–4 wk for
 * perishables); the fill turns crimson below it and amber above it.
 */
export function CoverBar({ cover, low, high }: { cover: number | null; low: number; high: number }) {
  if (cover == null) return <span className="text-ink-3">—</span>;
  const max = Math.max(high * 1.45, cover * 1.08);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const state = cover < low ? "bg-crit" : cover > high ? "bg-warn" : "bg-ok";
  const label = cover < low ? "below minimum" : cover > high ? "above maximum" : "inside window";
  return (
    <div className="flex items-center gap-2" title={`${cover.toFixed(1)} weeks of cover — ${label} (healthy ${low}–${high} wk)`}>
      <div className="relative h-2 w-24 shrink-0 rounded-full bg-surface-2" role="img" aria-label={`${cover.toFixed(1)} weeks of cover, ${label}`}>
        <span className="absolute inset-y-0 rounded-full bg-ok-soft ring-1 ring-inset ring-ok/20" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <span className={`absolute inset-y-0 left-0 rounded-full ${state}`} style={{ width: pct(cover) }} />
      </div>
      <span className="w-12 text-right text-[13px] font-medium tabular-nums text-ink">{cover.toFixed(1)}</span>
    </div>
  );
}

/** Weekly units for the last N weeks with the 4-week and 12-week averages. Bars <= 24px, rounded at the top only. */
export function WeeklyBars({ values, lastWeek, avg4, avg12 }: { values: number[]; lastWeek: string; avg4: number; avg12: number }) {
  const data = values.slice(-16);
  if (!data.length) return <p className="text-sm text-ink-3">No sales history.</p>;
  const W = 400;
  const H = 150;
  const m = { t: 10, r: 6, b: 22, l: 34 };
  const max = Math.max(...data, avg4, avg12) * 1.12;
  const slot = (W - m.l - m.r) / data.length;
  const bw = Math.min(24, slot - 3);
  const y = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b);
  const firstWeek = addDays(lastWeek, -7 * (data.length - 1));
  const ticks = [0, max / 2, max].map((t) => Math.round(t / 10) * 10);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly units, last ${data.length} weeks. 4-week average ${avg4.toFixed(0)}, 12-week average ${avg12.toFixed(0)}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
          <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
            {t >= 1000 ? `${(t / 1000).toFixed(1)}K` : t}
          </text>
        </g>
      ))}
      {data.map((v, i) => {
        const x = m.l + i * slot + (slot - bw) / 2;
        const recent = i >= data.length - 4;
        const top = y(v);
        const h = H - m.b - top;
        const r = Math.min(4, h / 2);
        return (
          <path
            key={i}
            d={`M${x},${H - m.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - m.b} Z`}
            fill={recent ? "var(--accent)" : "var(--ink-3)"}
            fillOpacity={recent ? 0.9 : 0.35}
          >
            <title>{`Week of ${shortDate(addDays(firstWeek, i * 7))}: ${v.toLocaleString("en-IN")} units`}</title>
          </path>
        );
      })}
      <line x1={m.l} x2={W - m.r} y1={y(avg12)} y2={y(avg12)} stroke="var(--ink-2)" strokeWidth="1.5" />
      <text x={m.l + 4} y={y(avg12) - 4} textAnchor="start" fontSize="10" fill="var(--ink-2)">
        12-wk avg {avg12.toFixed(0)}
      </text>
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
        <text key={i} x={m.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
          {shortDate(addDays(firstWeek, i * 7))}
        </text>
      ))}
    </svg>
  );
}
