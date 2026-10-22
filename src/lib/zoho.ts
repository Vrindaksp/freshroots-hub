/**
 * Shapes an approved purchase order like a Zoho Inventory "Create Purchase Order" request body, so the
 * staging table can be pushed to Zoho later without remapping. Nothing here calls Zoho — the hub stages,
 * Raghav signs off, and a separate push job (or CSV export) hands the staged rows over.
 *
 * Zoho's item_id and vendor_id are placeholders derived from our own IDs until the real mapping exists.
 */
export interface StagedPoInput {
  id: number;
  skuId: string;
  skuName: string;
  qty: number;
  unitCost: number | null;
  distributorId: string | null;
  distributorName: string | null;
  uom: string;
  reason: string | null;
  approvedOn: string;
}

export function buildZohoPayload(po: StagedPoInput) {
  return {
    purchaseorder: {
      reference_number: `FR-PO-${String(po.id).padStart(6, "0")}`,
      date: po.approvedOn,
      vendor_id: po.distributorId ? `ZV-${po.distributorId}` : null,
      vendor_name: po.distributorName,
      line_items: [
        {
          item_id: `ZI-${po.skuId}`,
          name: po.skuName,
          unit: po.uom,
          quantity: po.qty,
          rate: po.unitCost,
        },
      ],
      notes: po.reason ? `Planner override: ${po.reason}` : "Approved from Freshroots Demand Planning Engine",
    },
  };
}
