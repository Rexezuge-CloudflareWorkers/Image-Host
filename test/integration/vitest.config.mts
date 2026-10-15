import { defineIntegrationVitestConfig } from '@rexezuge/tooling/vitest-integration';
import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .toSorted((left, right) => left.localeCompare(right));
const migrationEntries = migrationFiles.map((file) => ({
  name: file,
  sql: readFileSync(path.resolve(migrationsDir, file), 'utf8'),
}));
// Both forms are injected: the per-file list so a test can apply a named range,
// and the flattened string for harnesses that only want the whole bundle.
const migrationSql = migrationEntries.map((entry) => entry.sql).join('\n\n');

/**
 * The workerd integration suite, on the kit's factory.
 *
 * The factory generates the `@image-host/* → src` table from `scope`, so this
 * table cannot drift from the unit suite's — a suite resolving a workspace import
 * differently from its sibling fails in a way that looks like a product bug. The
 * `plugins`, `pool` and `define` blocks are harness wiring the factory passes
 * through untouched, by design: importing the workerd plugin into the tooling
 * package would make it undownloadable for a consumer without one.
 */
export default defineIntegrationVitestConfig({
  scope: '@image-host',
  root: new URL('../../', import.meta.url).href,
  packages: ['shared', 'backend-data', 'provider-clients', 'backend-services'],
  include: ['test/integration/**/*.int.test.ts'],
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  ],
  pool: cloudflarePool({
    wrangler: {
      configPath: './test/integration/wrangler.test.jsonc',
    },
  }),
  // The harness injects the migration bundle as a compile-time constant, which is
  // what lets a test apply a *named range* rather than the whole set.
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
    __INTEGRATION_MIGRATION_FILES__: JSON.stringify(migrationEntries),
  },
  aliases: [
    {
      find: '@image-host/web',
      replacement: fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
    },
  ],
  // `hono` is a peer of the kit rather than a dependency, so a `link:` install can
  // hand two copies to Node. Two `hono` means two `HTTPException` identities and a
  // `toErrorResponse` that does not recognise what a route threw.
  ssrNoExternal: ['hono', '@image-host'],
});
