import { closeDb, databaseBackend } from "../src/lib/db";
import { runMigrations } from "../src/lib/migrate";

async function main() {
  console.log(`Database backend: ${databaseBackend()}`);
  await runMigrations();
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
