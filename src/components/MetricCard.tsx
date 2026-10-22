import { formatINRCompact, formatNumber } from "@/lib/format";
import type { MetricCard as Card } from "@/lib/metrics/queries";
import { SOURCE_LABEL } from "@/lib/metrics/registry";
import { Badge, TONE_TEXT, type Tone } from "./ui";
import { Sparkline } from "./Sparkline";

function formatValue(card: Card): string {
  const v = card.value;
  if (v == null) return "—";
  switch (card.def.unit) {
    case "inr":
      return formatINRCompact(v);
    case "pct":
      return `${v.toFixed(1)}%`;
    case "weeks":
      return `${v.toFixed(1)} wk`;
    default:
      return formatNumber(v);
  }
}

const STATUS: Record<Card["status"], { tone: Tone; label: string } | null> = {
  ok: null,
  neutral: null,
  empty: null,
  warn: { tone: "warn", label: "Watch" },
  crit: { tone: "crit", label: "Action" },
};

function Delta({ card }: { card: Card }) {
  if (card.previous == null) {
    return <span className="whitespace-nowrap text-xs text-ink-3">{card.def.grain === "snapshot" ? "First reading · trend builds daily" : "No prior week"}</span>;
  }
  const isPct = card.def.unit === "pct";
  const raw = isPct ? card.changePoints : card.change;
  if (raw == null) return null;
  const flat = isPct ? Math.abs(raw) < 0.05 : Math.abs(raw) < 0.005;
  const up = raw > 0;
  const good = card.def.better === "neutral" ? null : (up && card.def.better === "up") || (!up && card.def.better === "down");
  const tone: Tone = flat || good === null ? "neutral" : good ? "ok" : "crit";
  const text = isPct ? `${up ? "+" : ""}${raw.toFixed(1)} pts` : `${up ? "+" : ""}${(raw * 100).toFixed(1)}%`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${TONE_TEXT[tone]}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={flat ? "opacity-0" : up ? "" : "rotate-180"}>
        <path d="M5 1.5l3.5 5h-7z" fill="currentColor" />
      </svg>
      {flat ? "Flat" : text}
      <span className="font-normal text-ink-3">vs prior {card.def.grain === "week" ? "week" : "reading"}</span>
    </span>
  );
}

export function MetricCard({ card }: { card: Card }) {
  const status = STATUS[card.status];
  const barTone = card.status === "crit" ? "bg-crit" : card.status === "warn" ? "bg-warn" : "bg-transparent";
  return (
    <article className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)]">
      <span className={`absolute inset-y-0 left-0 w-1 ${barTone}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-medium text-ink-2" title={card.def.description}>
            {card.def.label}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {status && (
            <Badge tone={status.tone} icon>
              {status.label}
            </Badge>
          )}
          {card.source && card.source !== "derived" && (
            <Badge tone={card.source === "sample" ? "info" : "accent"} title={card.source === "sample" ? "Illustrative series: the seed data has no source for this metric. Connect a feed via /api/ingest." : "Pushed through the ingest API"}>
              {SOURCE_LABEL[card.source]}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[28px] font-semibold leading-8 tracking-tight text-ink">{formatValue(card)}</p>
          <div className="mt-1.5 min-h-4">
            <Delta card={card} />
          </div>
        </div>
        {card.series.length > 1 && <Sparkline values={card.series} width={112} height={34} label={`${card.def.label} trend, ${card.series.length} readings`} />}
      </div>
      <p className="mt-2 line-clamp-1 text-[11px] text-ink-3">{card.def.description}</p>
    </article>
  );
}
