import { closeDb, databaseBackend, query } from "../src/lib/db";

/** Drops every table. On Neon this erases real data, so it demands --yes. */
async function main() {
  if (databaseBackend() === "neon" && !process.argv.includes("--yes")) {
    console.error("Refusing to wipe the Neon database without --yes:  npm run db:reset -- --yes");
    process.exit(1);
  }
  await query("drop schema public cascade");
  await query("create schema public");
  console.log("schema reset — run `npm run db:setup` to rebuild");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
