"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { onStartTour, setKillSwitchOpen, startTour, type TourId } from "./events";
import { TOURS } from "./tour-steps";
import { btnBase, btnGhost, btnPrimary, btnSecondary } from "./ui";

const SEEN_KEY = "fr-tour-seen";
const FLAG_EVENT = "fr:flag";
const PAD = 8;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** localStorage flag as external state. The server snapshot is "seen" so first paint never flashes the prompt. */
function useSeen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(FLAG_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(FLAG_EVENT, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return true; // storage blocked: never nag
      }
    },
    () => true,
  );
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(FLAG_EVENT));
}

/** Pages keep hidden copies of previous routes alive, so only a laid-out element counts as the target. */
function findVisible(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

function bring(el: HTMLElement) {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (el.closest('[role="dialog"]')) {
    el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    return;
  }
  const r = el.getBoundingClientRect();
  const tall = r.height > window.innerHeight * 0.6;
  const top = tall ? window.scrollY + r.top - 90 : window.scrollY + r.top - (window.innerHeight - r.height) / 2;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
}

const near = (a: Rect, b: DOMRect) =>
  Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

export function Tour() {
  const router = useRouter();
  const seen = useSeen();
  const [active, setActive] = useState<{ id: TourId; index: number } | null>(null);
  const [measured, setMeasured] = useState<{ stepId: string; rect: Rect } | null>(null);

  const steps = active ? TOURS[active.id] : [];
  const step = active ? steps[active.index] : null;

  const go = useCallback(
    (id: TourId, index: number) => {
      const next = TOURS[id][index];
      setActive({ id, index });
      setKillSwitchOpen(Boolean(next.openKill));
      if (next.path && window.location.pathname !== next.path) router.push(next.path);
    },
    [router],
  );

  const end = useCallback(() => {
    setActive(null);
    setKillSwitchOpen(false);
    markSeen();
  }, []);

  useEffect(() => onStartTour((id) => go(id, 0)), [go]);

  // Keyboard: arrows move, Escape ends. Captured so the kill-switch dialog's own Escape handler does not also fire.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        end();
      } else if (e.key === "ArrowRight" && active.index < steps.length - 1) go(active.id, active.index + 1);
      else if (e.key === "ArrowLeft" && active.index > 0) go(active.id, active.index - 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, steps.length, go, end]);

  // Keep the spotlight on its target: wait for it to render (data streams in), scroll to it once, then track layout changes.
  const stepId = step?.id;
  const target = step?.target;
  useEffect(() => {
    if (!stepId || !target) return;
    let scrolled = false;
    const tick = () => {
      const el = findVisible(target);
      if (!el) return;
      if (!scrolled) {
        scrolled = true;
        bring(el);
      }
      const r = el.getBoundingClientRect();
      setMeasured((m) => (m && m.stepId === stepId && near(m.rect, r) ? m : { stepId, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }));
    };
    const raf = requestAnimationFrame(tick);
    const timer = setInterval(tick, 200);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [stepId, target]);

  if (!active || !step) {
    if (seen) return null;
    return (
      <div role="dialog" aria-label="Take the tour" className="fixed bottom-4 right-4 z-[55] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-2xl">
        <p className="text-[14px] font-semibold text-ink">New here? Take the 4-minute tour</p>
        <p className="mt-1 text-[13px] text-ink-2">See what each page does, how to approve a purchase order, and how the kill switch works.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className={btnPrimary} onClick={() => startTour("platform")}>
            Start tour
          </button>
          <button type="button" className={btnGhost} onClick={markSeen}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  const rect = step.target && measured?.stepId === step.id ? measured.rect : null;
  const last = active.index === steps.length - 1;
  const lowerHalf = rect ? rect.top + rect.height / 2 > window.innerHeight / 2 : false;
  const placement = rect
    ? `${lowerHalf ? "top-20" : "bottom-6"} left-4 right-4 sm:left-auto sm:right-6 sm:w-[400px]`
    : "left-4 right-4 top-1/2 -translate-y-1/2 sm:left-1/2 sm:right-auto sm:w-[460px] sm:-translate-x-1/2";

  return (
    <>
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] rounded-xl ring-2 ring-accent transition-all duration-200"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 100vmax rgba(15,23,42,0.58)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-slate-900/58" />
      )}

      <div role="dialog" aria-label="Guided tour" aria-live="polite" className={`fixed z-[61] rounded-2xl border border-line bg-surface p-4 shadow-2xl ${placement}`}>
        <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
          <span className="font-medium uppercase tracking-wide">{step.section}</span>
          <span>
            {active.index + 1} / {steps.length}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((active.index + 1) / steps.length) * 100}%` }} />
        </div>
        <h2 className="mt-3 text-[15px] font-semibold text-ink">{step.title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
        {step.target && !rect && <p className="mt-2 text-xs text-ink-3">Loading this part of the page…</p>}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className={`${btnBase} text-ink-3 hover:text-ink`} onClick={end}>
            {last ? "Close" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={active.index === 0} onClick={() => go(active.id, active.index - 1)}>
              Back
            </button>
            <button type="button" className={btnPrimary} onClick={() => (last ? end() : go(active.id, active.index + 1))}>
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Tip: use the ← → keys, Esc to leave.</p>
      </div>
    </>
  );
}
