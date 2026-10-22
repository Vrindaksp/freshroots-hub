"use client";

import { useState } from "react";

export interface RegionSeries {
  region: string;
  values: number[];
}

const COLORS = ["var(--s1)", "var(--s2)", "var(--s3)"];
const W = 640;
const H = 230;
const M = { top: 12, right: 18, bottom: 28, left: 40 };

/**
 * Weekly orders by region, indexed so each region's own 12-week average = 100. One axis, so a 165-unit region
 * and a 945-unit region can be compared on movement rather than size. Hover shows the actual units.
 */
export function RegionTrend({ weeks, series }: { weeks: string[]; series: RegionSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = series.slice(0, 3);
  const n = weeks.length;
  if (!n || !shown.length) return <p className="p-4 text-sm text-ink-3">No regional data yet.</p>;

  const indexed = shown.map((s) => {
    const avg = s.values.reduce((a, b) => a + b, 0) / (s.values.length || 1) || 1;
    return { region: s.region, values: s.values, idx: s.values.map((v) => (v / avg) * 100) };
  });
  const all = indexed.flatMap((s) => s.idx);
  const lo = Math.floor((Math.min(...all, 90) - 2) / 5) * 5;
  const hi = Math.ceil((Math.max(...all, 110) + 2) / 5) * 5;
  const x = (i: number) => M.left + (n === 1 ? 0 : (i * (W - M.left - M.right)) / (n - 1));
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const label = (w: string) => {
    const d = new Date(`${w}T00:00:00Z`);
    return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - M.left) / (W - M.left - M.right)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-ink-2" aria-label="Legend">
        {indexed.map((s, i) => (
          <li key={s.region} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
            {s.region}
          </li>
        ))}
      </ul>

      <div className="relative px-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Weekly orders by region indexed to each region's 12-week average" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
                {Math.round(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(100)} y2={y(100)} stroke="var(--line-strong)" strokeWidth="1" />
          {weeks.map((w, i) =>
            i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
              <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                {label(w)}
              </text>
            ) : null,
          )}

          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--line-strong)" strokeWidth="1" />}
          {indexed.map((s, i) => (
            <g key={s.region}>
              <polyline fill="none" stroke={COLORS[i]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={s.idx.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
              <circle cx={x(hover ?? n - 1)} cy={y(s.idx[hover ?? n - 1])} r="4" fill={COLORS[i]} stroke="var(--surface)" strokeWidth="2" />
            </g>
          ))}
        </svg>

        {hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > n / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
          >
            <p className="mb-1 font-medium text-ink">Week of {label(weeks[hover])}</p>
            {indexed.map((s, i) => (
              <p key={s.region} className="flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
                  {s.region}
                </span>
                <span className="font-medium tabular-nums text-ink">{s.values[hover].toLocaleString("en-IN")}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <details className="border-t border-line px-4 py-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none font-medium text-ink-2">Data table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1 pr-3 font-medium">Week of</th>
                {indexed.map((s) => (
                  <th key={s.region} className="px-2 py-1 text-right font-medium">
                    {s.region}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w} className="border-t border-line">
                  <td className="py-1 pr-3">{label(w)}</td>
                  {indexed.map((s) => (
                    <td key={s.region} className="px-2 py-1 text-right">
                      {s.values[i].toLocaleString("en-IN")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
