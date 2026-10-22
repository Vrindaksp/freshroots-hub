"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";
import { regenerateBrief, runPlanningEngine, approveCleanDrafts } from "@/app/actions";
import { btnGhost, btnPrimary, btnSecondary } from "./ui";

type Variant = "primary" | "secondary" | "ghost";
const VARIANT: Record<Variant, string> = { primary: btnPrimary, secondary: btnSecondary, ghost: btnGhost };

function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

/** Runs a server action and reports its result inline (polite live region, auto-clears). */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "secondary",
  confirm,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  pendingLabel?: string;
  variant?: Variant;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), result.ok ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={VARIANT[variant]}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await action()));
        }}
      >
        {pending && <Spinner />}
        {pending ? (pendingLabel ?? "Working…") : children}
      </button>
      <span aria-live="polite" className="max-w-[28rem] text-xs">
        {result && <span className={result.ok ? "text-ok" : "text-crit"}>{result.ok ? result.message : result.error}</span>}
      </span>
    </span>
  );
}

export function RunEngineButton({ variant = "primary" }: { variant?: Variant }) {
  return (
    <ActionButton action={runPlanningEngine} variant={variant} pendingLabel="Running engine…">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
      </svg>
      Run planning engine
    </ActionButton>
  );
}

export function ApproveCleanButton() {
  return (
    <ActionButton
      action={approveCleanDrafts}
      variant="secondary"
      pendingLabel="Approving…"
      confirm="Approve every draft that follows the rules exactly and was not flagged for review? Drafts you edited and edge cases are left untouched."
    >
      Approve rule-clean drafts
    </ActionButton>
  );
}

export function RegenerateBriefButton() {
  return (
    <ActionButton action={regenerateBrief} variant="ghost" pendingLabel="Writing…">
      Regenerate
    </ActionButton>
  );
}

/** Re-fetches server data on an interval so the dashboard behaves like a live view, not a weekly export. */
export function LiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [stamp, setStamp] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    const tick = () => setStamp(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(() => {
      start(() => router.refresh());
      tick();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3" title={`Refreshes every ${seconds}s`}>
      <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
      Live{stamp ? ` · checked ${stamp}` : ""}
    </span>
  );
}
