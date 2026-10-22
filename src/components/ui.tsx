import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "crit" | "info" | "accent" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-ink-2",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  info: "text-info",
  accent: "text-accent",
  neutral: "text-ink-3",
};

/** Status never relies on colour alone: every tone with meaning gets a glyph. */
export function ToneIcon({ tone, size = 12 }: { tone: Tone; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (tone === "ok") return (<svg {...common}><path d="M3 8.5l3.2 3L13 4.5" /></svg>);
  if (tone === "warn") return (<svg {...common}><path d="M8 2.5l6 10.5H2z" /><path d="M8 7v2.8M8 11.6v.1" /></svg>);
  if (tone === "crit") return (<svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8.4M8 10.9v.1" /></svg>);
  if (tone === "info") return (<svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.6M8 5v.1" /></svg>);
  return null;
}

export function Badge({ tone = "neutral", children, icon = false, title, className = "" }: { tone?: Tone; children: ReactNode; icon?: boolean; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONE_CLASS[tone]} ${className}`}>
      {icon && <ToneIcon tone={tone} size={11} />}
      {children}
    </span>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`rounded-xl border border-line bg-surface shadow-[var(--shadow)] ${className}`}>{children}</Tag>;
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`fr-skeleton ${className}`} aria-hidden />;
}

export function SectionSkeleton({ rows = 3, height = "h-24" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${height} w-full`} />
      ))}
    </div>
  );
}

export const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-accent text-accent-ink hover:brightness-110`;
export const btnSecondary = `${btnBase} border border-line-strong bg-surface text-ink hover:bg-surface-2`;
export const btnGhost = `${btnBase} text-ink-2 hover:bg-surface-2`;
