import { env, applyD1Migrations } from 'cloudflare:test';
import { splitSql } from '@rexezuge/d1';
import type { D1Migration } from 'cloudflare:test';

/**
 * Migration application for the workerd suite.
 *
 * Reads the bundle the Vitest config injects as a compile-time constant rather
 * than from `node:fs`. That is not a convenience: `test/integration/**` executes
 * **inside workerd**, where `node:fs` does not exist, so a disk-reading fallback
 * would fail at the exact moment it was reached — and only on the run where the
 * injection had failed. One source of truth, and its absence is a build error at
 * the `declare const` in `global.d.ts`.
 */
let applied = false;

/**
The injected bundle, converted to the shape `applyD1Migrations` takes.
*/
function migrationList(): D1Migration[] {
  return __INTEGRATION_MIGRATION_FILES__.map((entry) => ({
    name: entry.name,
    // `splitSql` rather than `[entry.sql]`: a migration file holding several
    // statements is one entry with one `queries` element, and D1 runs each as a
    // separate query — so passing the file whole would send a multi-statement string
    // to a single-statement API.
    queries: splitSql(entry.sql),
  }));
}

/**
 * Applies every migration, once per worker isolate.
 *
 * The module-level flag rather than a Vitest `beforeAll`: the Workers pool gives
 * each test file its own isolate and its own D1, so the first test in a file is
 * the only one that needs the schema. Applying per-test would re-run DDL against a
 * database that already has the tables and fail on the `CREATE TABLE`.
 */
export async function useDatabase(): Promise<D1Database> {
  if (!applied) {
    applied = true;
    await applyD1Migrations(env.ImageHostDB, migrationList());
  }
  return env.ImageHostDB;
}

/**
The whole schema as one string, for a suite that would rather apply it by hand.
*/
export function migrationSqlBundle(): string {
  return __INTEGRATION_MIGRATION_SQL__;
}

/**
Empties both tables. Called by a suite that needs a known starting state.
*/
export async function resetDatabase(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM image_views').run();
  await db.prepare('DELETE FROM images').run();
}
