import { closeDb, databaseBackend, query } from "../src/lib/db";
import { geminiConfigured } from "../src/lib/ai/gemini";
import { refreshIntelligence } from "../src/lib/intelligence";
import { runMigrations } from "../src/lib/migrate";
import { seedSampleOperationalMetrics } from "../src/lib/metrics/snapshot";
import { ingestSeedData } from "../src/lib/seed/ingest";

/** One command from an empty database to a working dashboard: migrate → seed → engine → metrics → alerts → AI. */
async function main() {
  const backend = databaseBackend();
  console.log(
    backend === "neon"
      ? "Database: Neon (DATABASE_URL)"
      : "Database: embedded PGlite in .data/pglite (set DATABASE_URL in .env.local to use Neon)",
  );
  console.log(`Gemini: ${geminiConfigured() ? "configured" : "not configured — rule-based commentary will be used"}\n`);

  await runMigrations();
  await ingestSeedData();
  if (!process.argv.includes("--no-sample")) {
    const weeks = await query<{ wk: string }>(
      `select distinct to_char(date_trunc('week', date)::date, 'YYYY-MM-DD') as wk from sales_history order by 1`,
    );
    await seedSampleOperationalMetrics(weeks.map((w) => w.wk));
  }

  const result = await refreshIntelligence({ ignoreKillSwitch: true });
  const { run } = result;
  console.log(`\nEngine run #${run.runId} as of ${run.asOf} (festival uplift ${run.uplift * 100}%)`);
  console.log(`  ${run.reorder} reorder · ${run.pause} paused · ${run.hold} hold · ${run.edgeCases} edge cases for Gemini review`);
  console.log(`  ${run.draftPos} draft POs worth ₹${Math.round(run.draftValue).toLocaleString("en-IN")} awaiting sign-off`);
  console.log(`  ${result.metricsWritten} weekly metric readings, ${result.alerts.active} active alerts, ${result.commentaryGenerated} commentary items`);
  console.log("\nNext: npm run dev  →  http://localhost:3000");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
