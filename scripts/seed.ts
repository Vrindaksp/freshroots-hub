import { closeDb, query } from "../src/lib/db";
import { runMigrations } from "../src/lib/migrate";
import { seedSampleOperationalMetrics } from "../src/lib/metrics/snapshot";
import { ingestSeedData } from "../src/lib/seed/ingest";

/**
 * Loads data/seed/*.csv into the database (idempotent upserts).
 *   npm run db:seed                 CSVs + labelled sample series for metrics the CSVs cannot supply
 *   npm run db:seed -- --no-sample  CSVs only
 */
async function main() {
  const withSample = !process.argv.includes("--no-sample");
  await runMigrations();
  const summary = await ingestSeedData();

  if (withSample) {
    const weeks = await query<{ wk: string }>(
      `select distinct to_char(date_trunc('week', date)::date, 'YYYY-MM-DD') as wk from sales_history order by 1`,
    );
    const n = await seedSampleOperationalMetrics(weeks.map((w) => w.wk));
    console.log(`sample operational metrics: ${n} readings (fulfillment, on-time delivery, complaints, write-offs — source='sample')`);
  }
  console.log("seed complete", summary);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
