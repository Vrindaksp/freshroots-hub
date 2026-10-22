# Seed data

`npm run db:seed` (or `db:setup`) loads these files into Postgres. Every load is an **upsert on the source IDs**, so you can replace a file with a fresh export and re-run it safely.

| File | Columns | Loads into |
|---|---|---|
| `distributors.csv` | `Distributor_ID, Distributor_Name, Region, Status` | `distributors` |
| `skus.csv` | `SKU_ID, SKU_Name, Category, Perishability, Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID` | `skus` |
| `calendar.csv` | `Year, Month, Year_Month, Is_Festival_Month` | `calendar` |
| `weekly_sales.csv` | `SKU_ID, Week, Units_Sold` (`Week` is ISO, e.g. `2026-W42`) | `sales_history` |
| `current_inventory.csv` | `SKU_ID, Location, Units_On_Hand, As_Of_Date` | `inventory_levels` |
| `sku_pricing.csv` | `SKU_ID, Unit_Cost_INR, Unit_Price_INR, Source` | `skus.unit_cost_inr / unit_price_inr` |

The first five are your files, unmodified. `sku_pricing.csv` is **mine**.

## What the source files do not contain — and what the app does about it

| Gap | Handling |
|---|---|
| **No unit costs or prices.** | `sku_pricing.csv` holds **placeholder** rupee values so cost-based figures (PO value, overstock value, savings) can render. They are plausible FMCG numbers, not Freshroots' real rates. The executive view says so wherever ₹ appears. Replace the file with real Zoho item rates and re-run `npm run db:seed`. |
| **No distributor or channel on sales rows.** | Each SKU's sales are attributed to the distributor on the SKU master (`Distributor_ID`). That is what makes the regional roll-up (Maharashtra / Karnataka / Gujarat) possible. If SKUs are really sold through several distributors, regional figures are approximate until a distributor-level sales export is loaded (the `sales_history` table already has `distributor_id` and `channel`). |
| **No open purchase orders.** | `inventory_levels.open_purchase_orders` loads as 0. POs approved in this app *after* the stock snapshot date are counted as on order automatically. |
| **No `average_weekly_sales`.** | Computed from the 12 complete weeks before the stock snapshot and written back to `inventory_levels` on every load and engine run. |
| **Fulfillment rate, on-time delivery, complaints, write-offs.** | Not derivable from these tables. `npm run db:seed` writes clearly labelled `sample` series (`operational_metrics.source = 'sample'`, shown with a **Sample** badge). Use `npm run db:seed -- --no-sample` to omit them, and push real values through `POST /api/ingest`. |

## Two facts that shape the numbers

- **As-of date = the stock snapshot date** (`2026-10-19`), not the machine clock. October is a festival month in `calendar.csv`, so the +25% demand uplift is applied.
- The brief mentions 1,200 distributors and Goa; the supplied data has 4 distributors in Maharashtra, Karnataka and Gujarat. The schema handles any number; only this sample is small.
