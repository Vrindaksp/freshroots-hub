import { connection } from "next/server";
import { Suspense } from "react";
import { ActionButton } from "@/components/ActionButtons";
import { SkuCatalogue } from "@/components/SkuCatalogue";
import { btnSecondary, PageTitle, Skeleton } from "@/components/ui";
import { getCatalogue } from "@/lib/skus/queries";
import { readZohoConfig } from "@/lib/zoho/config";
import { syncAllSkusToZoho } from "../zoho-actions";

export const metadata = { title: "SKU catalogue · Freshroots Operations Hub" };

export default function SkusPage() {
  return (
    <>
      <PageTitle
        title="SKU catalogue"
        subtitle="Add SKUs by hand, remove ones you no longer stock, and keep them in step with Zoho Inventory."
        actions={
          <span data-tour="sku-zoho" className="flex flex-wrap items-center gap-2">
            <a href="/api/zoho/export?type=items" className={btnSecondary} download>
              Export items for Zoho (CSV)
            </a>
            <Suspense fallback={null}>
              <SyncAllButton />
            </Suspense>
          </span>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CatalogueBody />
      </Suspense>
    </>
  );
}

async function SyncAllButton() {
  await connection();
  if (!readZohoConfig().config) return null;
  return (
    <ActionButton action={syncAllSkusToZoho} variant="secondary" pendingLabel="Syncing to Zoho…" confirm="Create or link every active SKU as an item in Zoho Inventory? Existing Zoho items with the same SKU code are linked, not duplicated.">
      Sync all to Zoho
    </ActionButton>
  );
}

async function CatalogueBody() {
  await connection();
  const { skus, distributors, categories, locations } = await getCatalogue();
  return <SkuCatalogue skus={skus} distributors={distributors} categories={categories} locations={locations} zohoReady={Boolean(readZohoConfig().config)} />;
}
