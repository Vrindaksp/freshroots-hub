import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionButton } from "@/components/ActionButtons";
import { ZohoPushPanel } from "@/components/ZohoPushPanel";
import { Badge, btnSecondary, Card, CardHeader, PageTitle, Skeleton, ToneIcon } from "@/components/ui";
import { ZOHO_DATA_CENTRES } from "@/lib/zoho/config";
import { getZohoOverview } from "@/lib/zoho/sync";
import { testZohoConnectionAction } from "../zoho-actions";

export const metadata = { title: "Zoho Inventory · Freshroots Operations Hub" };

export default function ZohoPage() {
  return (
    <>
      <PageTitle title="Zoho Inventory" subtitle="Send approved purchase orders and your SKU catalogue to Zoho, or download them as files for Zoho's import wizard." />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ZohoBody />
      </Suspense>
    </>
  );
}

function time(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

async function ZohoBody() {
  await connection();
  const o = await getZohoOverview();

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card tour="zoho-connection" className="lg:col-span-2">
          <CardHeader
            title="Connection"
            subtitle="Credentials are read from server environment variables and never reach the browser."
            right={
              o.configured ? (
                <Badge tone="ok" icon>
                  Credentials set · data centre .{o.dc} · org {o.organizationHint}
                </Badge>
              ) : (
                <Badge tone="warn" icon>
                  Not connected
                </Badge>
              )
            }
          />
          <div className="space-y-3 p-4 text-[13px]">
            {o.configured ? (
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton action={testZohoConnectionAction} variant="secondary" pendingLabel="Testing…">
                  Test connection
                </ActionButton>
                <span className="text-ink-3">A read-only check: it asks Zoho for your organisation and creates nothing.</span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-ink-2">{o.problem ?? "Zoho is not connected yet. File exports below work without it; pushing needs these server variables:"}</p>
                {o.missing.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {o.missing.map((m) => (
                      <li key={m}>
                        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-crit">{m}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <details className="rounded-lg border border-line px-3 py-2">
              <summary className="cursor-pointer select-none font-medium text-ink">How to connect (about 5 minutes)</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-2">
                <li>
                  Open the API console for your data centre (India: <code className="rounded bg-surface-2 px-1">api-console.zoho.in</code>, US: <code className="rounded bg-surface-2 px-1">.com</code>; supported: {ZOHO_DATA_CENTRES.join(", ")}) and choose <strong>Self Client</strong>.
                </li>
                <li>
                  On <strong>Generate Code</strong>, enter the scopes{" "}
                  <code className="break-all rounded bg-surface-2 px-1 text-xs">
                    ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.contacts.CREATE,ZohoInventory.contacts.READ,ZohoInventory.settings.READ
                  </code>
                  , pick a 3–10 minute expiry and press Create.
                </li>
                <li>
                  Exchange the code (it works once) for a refresh token:{" "}
                  <code className="break-all rounded bg-surface-2 px-1 text-xs">
                    curl -X POST https://accounts.zoho.{o.dc}/oauth/v2/token -d grant_type=authorization_code -d client_id=… -d client_secret=… -d code=…
                  </code>
                </li>
                <li>
                  Set <code className="rounded bg-surface-2 px-1">ZOHO_DC</code>, <code className="rounded bg-surface-2 px-1">ZOHO_CLIENT_ID</code>, <code className="rounded bg-surface-2 px-1">ZOHO_CLIENT_SECRET</code>, <code className="rounded bg-surface-2 px-1">ZOHO_REFRESH_TOKEN</code> and{" "}
                  <code className="rounded bg-surface-2 px-1">ZOHO_ORGANIZATION_ID</code> in <code className="rounded bg-surface-2 px-1">.env.local</code> and in Vercel, then redeploy. Press <strong>Test connection</strong>.
                </li>
              </ol>
            </details>
          </div>
        </Card>

        <Card tour="zoho-export">
          <CardHeader title="Download for Zoho" subtitle="Files for Zoho's import wizard. No connection needed." />
          <div className="space-y-2 p-4 text-[13px]">
            <a href="/api/zoho/export?type=items" download className={`${btnSecondary} w-full`}>
              Items (CSV)
            </a>
            <a href="/api/zoho/export?type=purchase-orders" download className={`${btnSecondary} w-full`}>
              Approved purchase orders (CSV)
            </a>
            <p className="text-xs text-ink-3">
              In Zoho, use Import and map any columns whose names differ. JSON versions: add <code className="rounded bg-surface-2 px-1">&amp;format=json</code> to the URL.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "POs ready to push", value: o.counts.awaiting, tone: o.counts.awaiting ? "text-accent" : "text-ink" },
          { label: "POs in Zoho", value: o.counts.pushed, tone: "text-ok" },
          { label: "POs failed", value: o.counts.failed, tone: o.counts.failed ? "text-crit" : "text-ink" },
          { label: "SKUs linked to Zoho", value: `${o.counts.itemsLinked} / ${o.counts.itemsActive}`, tone: "text-ink" },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow)]">
            <p className="text-xs text-ink-3">{t.label}</p>
            <p className={`mt-0.5 text-2xl font-semibold tracking-tight ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <ZohoPushPanel configured={o.configured} awaiting={o.counts.awaiting + o.counts.failed} pos={o.pos} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Items"
            subtitle="Each active SKU becomes a Zoho item, matched by its SKU code."
            right={
              <Link href="/skus" className="text-[13px] font-medium text-accent hover:underline">
                Open SKU catalogue →
              </Link>
            }
          />
          <p className="p-4 text-[13px] text-ink-2">
            {o.counts.itemsLinked} of {o.counts.itemsActive} active SKUs are linked. Use <strong>Sync to Zoho</strong> on a row, or <strong>Sync all to Zoho</strong>, in the catalogue. Pushing a purchase order also creates its item if it is missing.
          </p>
        </Card>
        <Card>
          <CardHeader title="Recent Zoho activity" subtitle="Every call to Zoho, successful or not." />
          {o.log.length ? (
            <ul className="divide-y divide-line text-[13px]">
              {o.log.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className={`mr-1.5 inline-block align-middle ${l.ok ? "text-ok" : "text-crit"}`}>
                      <ToneIcon tone={l.ok ? "ok" : "crit"} size={12} />
                    </span>
                    <span className="text-ink-3">{l.kind.replace("_", " ")}{l.ref ? ` ${l.ref}` : ""}:</span> <span className="text-ink-2">{l.message}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{time(l.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">Nothing yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
