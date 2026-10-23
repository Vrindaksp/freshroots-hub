import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { jsonParam, query } from "../db";
import { isoWeekToMonday } from "../dates";
import { DEFAULT_CONFIG } from "../engine/config";
import { refreshAverageWeeklySales } from "../engine/data";

/**
 * CSV ingestion for the five source datasets (plus an optional pricing file):
 *
 *   distributors.csv        Distributor_ID, Distributor_Name, Region, Status
 *   skus.csv                SKU_ID, SKU_Name, Category, Perishability, Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID
 *   calendar.csv            Year, Month, Year_Month, Is_Festival_Month
 *   weekly_sales.csv        SKU_ID, Week (ISO, e.g. 2026-W42), Units_Sold
 *   current_inventory.csv   SKU_ID, Location, Units_On_Hand, As_Of_Date
 *   sku_pricing.csv         SKU_ID, Unit_Cost_INR, Unit_Price_INR, Source      (optional — see README)
 *
 * Every load is an upsert on the source IDs, so re-running with refreshed files is safe.
 */

type Rec = Record<string, string>;

const SEED_DIR = path.join(process.cwd(), "data", "seed");

async function readCsv(file: string, required: string[], optional = false): Promise<Rec[]> {
  const full = path.join(SEED_DIR, file);
  if (!existsSync(full)) {
    if (optional) return [];
    throw new Error(`Missing seed file data/seed/${file}`);
  }
  const text = await readFile(full, "utf8");
  const rows = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Rec[];
  const first = rows[0];
  if (first) {
    const missing = required.filter((c) => !(c in first));
    if (missing.length) throw new Error(`data/seed/${file} is missing column(s): ${missing.join(", ")}`);
  }
  return rows;
}

function toInt(value: string, field: string, file: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${file}: "${value}" is not a whole number in ${field}`);
  return n;
}

function toBool(value: string): boolean {
  return /^(true|yes|y|1|active)$/i.test(value.trim());
}

function isoDate(value: string, file: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${file}: "${value}" is not a YYYY-MM-DD date`);
  return value;
}

export interface IngestSummary {
  distributors: number;
  skus: number;
  calendar: number;
  weeklySales: number;
  inventory: number;
  pricing: number;
  salesWeeks: { first: string; last: string };
}

export async function ingestSeedData(log: (msg: string) => void = console.log): Promise<IngestSummary> {
  // 1. Distributors ---------------------------------------------------------------------------
  const distributors = await readCsv("distributors.csv", ["Distributor_ID", "Distributor_Name", "Region", "Status"]);
  await query(
    `insert into distributors (id, name, region, active_status)
     select id, name, region, active_status
     from json_to_recordset($1::json) as t(id text, name text, region text, active_status boolean)
     on conflict (id) do update
       set name = excluded.name, region = excluded.region, active_status = excluded.active_status`,
    [
      jsonParam(
        distributors.map((r) => ({
          id: r.Distributor_ID,
          name: r.Distributor_Name,
          region: r.Region,
          active_status: toBool(r.Status),
        })),
      ),
    ],
  );
  log(`distributors: ${distributors.length}`);
  const distributorIds = new Set(distributors.map((r) => r.Distributor_ID));

  // 2. SKUs -----------------------------------------------------------------------------------
  const skus = await readCsv("skus.csv", [
    "SKU_ID",
    "SKU_Name",
    "Category",
    "Perishability",
    "Standard_Reorder_Qty",
    "Unit_of_Measure",
    "Distributor_ID",
  ]);
  for (const r of skus) {
    if (r.Distributor_ID && !distributorIds.has(r.Distributor_ID)) {
      throw new Error(`skus.csv: ${r.SKU_ID} references unknown distributor ${r.Distributor_ID}`);
    }
  }
  await query(
    `insert into skus (id, name, category, perishability_level, perishability_flag, standard_order_qty, unit_of_measure, distributor_id)
     select id, name, category, perishability_level, perishability_level = 'High', standard_order_qty, unit_of_measure, distributor_id
     from json_to_recordset($1::json)
       as t(id text, name text, category text, perishability_level text, standard_order_qty int, unit_of_measure text, distributor_id text)
     on conflict (id) do update
       set name = excluded.name, category = excluded.category,
           perishability_level = excluded.perishability_level, perishability_flag = excluded.perishability_flag,
           standard_order_qty = excluded.standard_order_qty, unit_of_measure = excluded.unit_of_measure,
           distributor_id = excluded.distributor_id`,
    [
      jsonParam(
        skus.map((r) => ({
          id: r.SKU_ID,
          name: r.SKU_Name,
          category: r.Category,
          perishability_level: /^high$/i.test(r.Perishability) ? "High" : "Low",
          standard_order_qty: toInt(r.Standard_Reorder_Qty, "Standard_Reorder_Qty", "skus.csv"),
          unit_of_measure: r.Unit_of_Measure || "Units",
          distributor_id: r.Distributor_ID || null,
        })),
      ),
    ],
  );
  log(`skus: ${skus.length}`);
  const skuIds = new Set(skus.map((r) => r.SKU_ID));
  const skuDistributor = new Map(skus.map((r) => [r.SKU_ID, r.Distributor_ID || null]));

  // 3. Pricing (optional, placeholder until real Zoho rates are loaded) --------------------------
  const pricing = await readCsv("sku_pricing.csv", ["SKU_ID", "Unit_Cost_INR", "Unit_Price_INR"], true);
  if (pricing.length) {
    await query(
      `update skus set unit_cost_inr = t.cost, unit_price_inr = t.price, pricing_source = t.source
       from json_to_recordset($1::json) as t(id text, cost numeric, price numeric, source text)
       where skus.id = t.id and coalesce(skus.pricing_source, 'placeholder') <> 'manual'`,
      [
        jsonParam(
          pricing.map((r) => ({
            id: r.SKU_ID,
            cost: Number(r.Unit_Cost_INR),
            price: Number(r.Unit_Price_INR),
            source: r.Source || "placeholder",
          })),
        ),
      ],
    );
  }
  log(`pricing: ${pricing.length} (${pricing.length ? "placeholder rates, see data/seed/README.md" : "none — ₹ figures will be empty"})`);

  // 4. Calendar -------------------------------------------------------------------------------
  const calendar = await readCsv("calendar.csv", ["Year", "Month", "Year_Month", "Is_Festival_Month"]);
  await query(
    `insert into calendar (year_month, year, month, is_festival_month, demand_uplift)
     select year_month, year, month, is_festival_month, case when is_festival_month then $2::numeric else 0 end
     from json_to_recordset($1::json) as t(year_month text, year int, month int, is_festival_month boolean)
     on conflict (year_month) do update
       set year = excluded.year, month = excluded.month,
           is_festival_month = excluded.is_festival_month, demand_uplift = excluded.demand_uplift`,
    [
      jsonParam(
        calendar.map((r) => ({
          year_month: r.Year_Month,
          year: toInt(r.Year, "Year", "calendar.csv"),
          month: toInt(r.Month, "Month", "calendar.csv"),
          is_festival_month: toBool(r.Is_Festival_Month),
        })),
      ),
      DEFAULT_CONFIG.festivalUplift,
    ],
  );
  log(`calendar: ${calendar.length} months (${calendar.filter((r) => toBool(r.Is_Festival_Month)).length} festival)`);

  // 5. Weekly sales -----------------------------------------------------------------------------
  // The source file has no distributor or channel, so each SKU's sales are attributed to the primary
  // distributor on the SKU master. That is what makes regional roll-ups possible.
  const sales = await readCsv("weekly_sales.csv", ["SKU_ID", "Week", "Units_Sold"]);
  const salesRows = sales.map((r) => {
    if (!skuIds.has(r.SKU_ID)) throw new Error(`weekly_sales.csv: unknown SKU ${r.SKU_ID}`);
    return {
      distributor_id: skuDistributor.get(r.SKU_ID),
      sku_id: r.SKU_ID,
      date: isoWeekToMonday(r.Week),
      quantity_sold: toInt(r.Units_Sold, "Units_Sold", "weekly_sales.csv"),
    };
  });
  await query(
    `insert into sales_history (distributor_id, sku_id, date, quantity_sold)
     select distributor_id, sku_id, date, quantity_sold
     from json_to_recordset($1::json) as t(distributor_id text, sku_id text, date date, quantity_sold int)
     on conflict (sku_id, date, coalesce(distributor_id, ''), coalesce(channel, ''))
     do update set quantity_sold = excluded.quantity_sold`,
    [jsonParam(salesRows)],
  );
  const dates = salesRows.map((r) => r.date).sort();
  const salesWeeks = { first: dates[0], last: dates[dates.length - 1] };
  log(`weekly sales: ${salesRows.length} rows, weeks starting ${salesWeeks.first} → ${salesWeeks.last}`);

  // 6. Current inventory ------------------------------------------------------------------------
  const inventory = await readCsv("current_inventory.csv", ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"]);
  await query(
    `insert into inventory_levels (sku_id, location, current_stock_units, as_of_date)
     select sku_id, location, current_stock_units, as_of_date
     from json_to_recordset($1::json) as t(sku_id text, location text, current_stock_units int, as_of_date date)
     on conflict (sku_id, location) do update
       set current_stock_units = excluded.current_stock_units, as_of_date = excluded.as_of_date`,
    [
      jsonParam(
        inventory.map((r) => {
          if (!skuIds.has(r.SKU_ID)) throw new Error(`current_inventory.csv: unknown SKU ${r.SKU_ID}`);
          return {
            sku_id: r.SKU_ID,
            location: r.Location || "Main",
            current_stock_units: toInt(r.Units_On_Hand, "Units_On_Hand", "current_inventory.csv"),
            as_of_date: isoDate(r.As_Of_Date, "current_inventory.csv"),
          };
        }),
      ),
    ],
  );
  await refreshAverageWeeklySales();
  log(`inventory: ${inventory.length} rows (average weekly sales derived from the 12-week rolling window)`);

  return {
    distributors: distributors.length,
    skus: skus.length,
    calendar: calendar.length,
    weeklySales: salesRows.length,
    inventory: inventory.length,
    pricing: pricing.length,
    salesWeeks,
  };
}
