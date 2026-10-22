import { query } from "@/lib/db";

/**
 * Zoho-staged purchase orders.
 *   GET /api/purchase-orders/export                 JSON, approved POs
 *   GET /api/purchase-orders/export?format=csv      CSV for manual import
 *   GET /api/purchase-orders/export?status=all
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "approved";
  const format = url.searchParams.get("format") ?? "json";
  const rows = await query<{
    id: number;
    sku_id: string;
    name: string;
    recommended_qty: number;
    final_qty: number;
    status: string;
    override_reason: string | null;
    decided_at: string | null;
    zoho_sync_status: string;
    zoho_payload: unknown;
  }>(
    `select p.id::int as id, p.sku_id, s.name, p.recommended_qty, p.final_qty, p.status, p.override_reason,
            to_char(p.decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as decided_at,
            p.zoho_sync_status, p.zoho_payload
     from purchase_orders p join skus s on s.id = p.sku_id
     where ($1 = 'all' or p.status = $1)
     order by p.id`,
    [status],
  );

  if (format === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = "po_id,sku_id,sku_name,recommended_qty,final_qty,status,override_reason,decided_at,zoho_sync_status";
    const lines = rows.map((r) =>
      [r.id, r.sku_id, r.name, r.recommended_qty, r.final_qty, r.status, r.override_reason, r.decided_at, r.zoho_sync_status].map(esc).join(","),
    );
    return new Response([header, ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="freshroots-purchase-orders.csv"',
      },
    });
  }
  return Response.json({ count: rows.length, purchase_orders: rows });
}
