import { neon } from "@neondatabase/serverless";

/**
 * Database access.
 *
 *  - With DATABASE_URL set (Neon connection string) every query goes over Neon's serverless HTTP driver.
 *  - Without it, outside production, an embedded PGlite Postgres in `.data/pglite` is used so the whole
 *    app runs with zero setup. Production refuses to start without DATABASE_URL.
 *
 * Rows are plain objects. Cast numerics in SQL (`::float8`, `::int`, `::text`) — Neon returns `numeric`
 * and `bigint` as strings, and a cast keeps both backends returning identical JS types.
 */

export type Row = Record<string, unknown>;

interface Backend {
  run: (text: string, params?: unknown[]) => Promise<Row[]>;
  close: () => Promise<void>;
}

const globalForDb = globalThis as unknown as { __freshrootsDb?: Promise<Backend> };

async function createBackend(): Promise<Backend> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = neon(url);
    return {
      run: async (text, params = []) => (await sql.query(text, params)) as Row[],
      close: async () => {},
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Add your Neon connection string to the environment.");
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdir } = await import("node:fs/promises");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    run: async (text, params = []) => (await pg.query(text, params)).rows as Row[],
    close: () => pg.close(),
  };
}

function backend(): Promise<Backend> {
  return (globalForDb.__freshrootsDb ??= createBackend());
}

export function databaseBackend(): "neon" | "pglite" {
  return process.env.DATABASE_URL ? "neon" : "pglite";
}

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const { run } = await backend();
  return (await run(text, params)) as T[];
}

export async function queryOne<T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

/** Bulk-write helper: rows ship as one JSON parameter and are expanded server-side with json_to_recordset. */
export function jsonParam(rows: unknown[]): string {
  return JSON.stringify(rows);
}

/** Flushes and closes the embedded database. Scripts call this before exit; Neon's HTTP driver needs nothing. */
export async function closeDb(): Promise<void> {
  const existing = globalForDb.__freshrootsDb;
  if (!existing) return;
  globalForDb.__freshrootsDb = undefined;
  await (await existing).close();
}
