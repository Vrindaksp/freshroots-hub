/** Minimal trend line: de-emphasised ink for history, accent dot with a surface ring for the current reading. */
export function Sparkline({ values, width = 120, height = 32, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length === 0) return <div style={{ width, height }} aria-hidden />;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (values.length - 1));
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? "Trend"} className="overflow-visible">
      {values.length > 1 && <polyline points={points} fill="none" stroke="var(--ink-3)" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      <circle cx={x(last)} cy={y(values[last])} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
