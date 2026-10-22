import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { query } from "./db";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/** Neon's HTTP driver runs one statement per request, so migration files are split on `;`. */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return withoutComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runMigrations(log: (msg: string) => void = console.log): Promise<number> {
  await query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);

  const applied = new Set(
    (await query<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = splitStatements(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    for (const statement of statements) await query(statement);
    await query("insert into schema_migrations (name) values ($1)", [file]);
    log(`applied ${file} (${statements.length} statements)`);
    count++;
  }
  if (count === 0) log("schema is up to date");
  return count;
}
