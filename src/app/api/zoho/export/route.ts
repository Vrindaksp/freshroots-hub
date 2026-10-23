import { query } from "@/lib/db";
import { itemsCsv, purchaseOrdersCsv, poReference } from "@/lib/zoho/payloads";

/**
 * File export for Zoho's import wizards (works without any Zoho credentials).
 *   GET /api/zoho/export?type=items                    CSV of active SKUs   (&include=removed adds removed SKUs, marked Inactive)
 *   GET /api/zoho/export?type=purchase-orders          CSV of approved POs  (&status=all for every PO)
 *   add &format=json for JSON instead of CSV
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "items";
  const format = url.searchParams.get("format") ?? "csv";
  if (type !== "items" && type !== "purchase-orders") return Response.json({ error: "type must be items or purchase-orders" }, { status: 400 });

  if (type === "items") {
    const includeRemoved = url.searchParams.get("include") === "removed";
    const rows = await query<{
      id: string; name: string; category: string; perishable: boolean; uom: string; cost: number | null; price: number | null; on_hand: number; vendor: string | null; archived: boolean;
    }>(
      `select s.id, s.name, s.category, s.perishability_flag as perishable, s.unit_of_measure as uom,
              s.unit_cost_inr::float8 as cost, s.unit_price_inr::float8 as price,
              coalesce((select sum(i.current_stock_units) from inventory_levels i where i.sku_id = s.id), 0)::int as on_hand,
              d.name as vendor, s.archived_at is not null as archived
       from skus s left join distributors d on d.id = s.distributor_id
       where ($1::boolean or s.archived_at is null)
       order by s.id`,
      [includeRemoved],
    );
    const items = rows.map((r) => ({
      id: r.id, name: r.name, category: r.category, perishable: r.perishable, unitOfMeasure: r.uom,
      unitCost: r.cost, unitPrice: r.price, onHand: r.on_hand, vendorName: r.vendor, archived: r.archived,
    }));
    if (format === "json") return Response.json({ count: items.length, items });
    return csvResponse(itemsCsv(items), "freshroots-items-for-zoho.csv");
  }

  const status = url.searchParams.get("status") ?? "approved";
  const rows = await query<{
    id: number; sku_id: string; name: string; qty: number; vendor: string | null; cost: number | null; decided_on: string; reason: string | null; status: string;
  }>(
    `select p.id::int as id, p.sku_id, s.name, p.final_qty::int as qty, d.name as vendor, s.unit_cost_inr::float8 as cost,
            to_char(coalesce(p.decided_at, p.created_at) at time zone 'UTC', 'YYYY-MM-DD') as decided_on, p.override_reason as reason, p.status
     from purchase_orders p join skus s on s.id = p.sku_id left join distributors d on d.id = s.distributor_id
     where ($1 = 'all' or p.status = $1)
     order by p.id`,
    [status],
  );
  const pos = rows.map((r) => ({
    poId: r.id, date: r.decided_on, vendorName: r.vendor, skuName: r.name, skuId: r.sku_id, quantity: r.qty, rate: r.cost,
    notes: r.reason ? `Override: ${r.reason}` : "Approved in the Freshroots hub", status: r.status,
  }));
  if (format === "json") return Response.json({ count: pos.length, purchase_orders: pos.map((p) => ({ reference: poReference(p.poId), ...p })) });
  return csvResponse(purchaseOrdersCsv(pos), "freshroots-purchase-orders-for-zoho.csv");
}

function csvResponse(body: string, filename: string) {
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
  });
}
