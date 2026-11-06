"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { startTour } from "./events";

const VIEWS = [
  { href: "/executive", label: "Executive view", short: "Executive" },
  { href: "/planner", label: "Demand planner view", short: "Planner" },
  { href: "/skus", label: "SKUs", short: "SKUs" },
  { href: "/zoho", label: "Zoho", short: "Zoho" },
  { href: "/decision", label: "Pre-build decision", short: "Decision" },
];

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function ThemeToggle() {
  // The <html> class is the source of truth (set before paint by the inline script in the layout).
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("fr-theme", next ? "dark" : "light");
    } catch {
      /* storage can be blocked; the toggle still works for this visit */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid h-8 w-8 place-items-center rounded-md border border-white/15 text-slate-200 transition hover:bg-white/10"
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function AppHeader({ controls }: { controls?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 bg-navy text-slate-100 shadow-sm">
      <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 md:min-h-14 md:flex-nowrap md:gap-x-4">
        <Link href="/executive" className="order-1 flex shrink-0 items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[#5b6adf] text-[13px] font-bold text-white" aria-hidden>
            F
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight lg:block">
            Freshroots <span className="font-normal text-slate-400">Operations Hub</span>
          </span>
        </Link>

        {/* Phones: logo + controls on one row, tabs on their own scrollable row. Desktop: everything in one row. */}
        <nav aria-label="Role view" className="order-3 w-full overflow-x-auto md:order-2 md:w-auto md:min-w-0 md:flex-1">
          <div role="tablist" data-tour="roles" className="flex w-max rounded-lg bg-white/10 p-0.5">
            {VIEWS.map((v) => {
              const active = pathname.startsWith(v.href);
              return (
                <Link
                  key={v.href}
                  href={v.href}
                  role="tab"
                  aria-selected={active}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
                    active ? "bg-white text-slate-900 shadow-sm" : "text-slate-300 hover:text-white"
                  }`}
                >
                  <span className="xl:hidden">{v.short}</span>
                  <span className="hidden xl:inline">{v.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 md:order-3">
          {controls}
          <button
            type="button"
            onClick={() => startTour("platform")}
            title="Guided tour of the platform and the kill switch"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-[13px] font-medium text-slate-100 transition hover:bg-white/10"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="8" cy="8" r="6" />
              <path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.3-.8.6-.8 1.2M8 11.3v.1" />
            </svg>
            <span className="hidden md:inline">Tour</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
