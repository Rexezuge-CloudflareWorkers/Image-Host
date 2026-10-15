import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';
import { fileURLToPath } from 'node:url';

/**
 * The unit suite, on the kit's single-file `projects` factory.
 *
 * The factory derives the workspace alias table for the packages this repo
 * actually has, the `cloudflare:workers` mock, the `hono` dedupe, and the
 * `node`/`dom` split by file extension. What it cannot derive is recorded here.
 */
export default defineRepoVitestConfig({
  scope: '@image-host',
  root: new URL('.', import.meta.url).href,

  /**
  The four packages under `packages/`.
  */
  packages: ['shared', 'backend-data', 'provider-clients', 'backend-services'],

  /**
   * Only `cloudflare:workers` is aliased. The family default also aliases
   * `cloudflare:sockets` and `cloudflare:workflows`; neither specifier appears in
   * this repository, and the mock's own header notes that an alias for an absent
   * mock fires only when a test imports the specifier — so listing them implies a
   * runtime surface this worker does not have.
   */
  mocks: ['workers'],

  backend: {
    include: ['test/**/*.test.ts'],
    // `**/node_modules/**` is Vitest's own default exclusion, and naming
    // `exclude` at all **replaces** that default rather than adding to it. That
    // was harmless while `test/` was outside the workspace and had no
    // `node_modules` of its own, and stopped being harmless the moment it became
    // a workspace project: pnpm then links `test/node_modules`, which sits under
    // the `test/**/*.test.ts` glob, and the suite collects the dependency's own
    // test files. Nothing announces it — the run reports failures from inside
    // `node_modules` that belong to no code in this repository.
    //
    // `test/integration/**` has its own config against real D1.
    exclude: ['**/node_modules/**', 'test/integration/**'],
  },

  web: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'test/integration/**'],
    setupFiles: ['test/setup/dom.ts'],
  },

  coverageInclude: [
    'apps/api/src/**/*.ts',
    // Web: services and lib are pure enough for the node project. Components are
    // JSX-heavy and mostly markup, and including them would move the aggregate
    // without adding meaningful signal.
    'apps/web/src/services/**/*.ts',
    'apps/web/src/lib/**/*.ts',
    'apps/web/src/hooks/**/*.ts',
    'packages/**/src/**/*.ts',
  ],

  coverageExclude: [
    // A token map is a pure `export *` over shared and has no executable
    // statements of its own.
    'apps/api/src/generated/**',
    // Type-only modules compile to no runnable code, so v8 reports 0% and they
    // would otherwise drag the aggregate down without any behaviour left to cover.
    'packages/backend-services/src/composition/ServiceEnv.ts',
    'packages/backend-services/src/composition/tokens.ts',
  ],

  /**
   * A measured floor, set a little under the figures this suite actually reports
   * (83.77 / 64.45 / 85.51 / 86.08) so ordinary churn does not fail the build but a
   * real regression does. Raise it as coverage improves — a floor nobody raises
   * stops saying anything.
   *
   * Branches is the weak number and is expected to be: most of the uncovered
   * branches are the Telegram client's failure paths and the auth service's
   * production guard, which the node project cannot exercise because they need a
   * `fetch` stub the integration pool would have to provide.
   *
   * Note what this number does *not* include: `test/integration/**` covers the
   * DAOs against real SQLite, and that coverage is not reported here. `packages/
   * backend-data/**` therefore looks low in the table below while being well
   * covered — read this report together with `pnpm run test:integration`.
   */
  thresholds: { statements: 83, branches: 63, functions: 84, lines: 85 },

  reportsDirectory: './coverage',

  /**
   * The SPA is reached as `@image-host/web/...`, and the factory derives aliases
   * for the scope only from directories it is told about — `packages/*`. The SPA
   * lives under `apps/web` and is published under the same scope as a workspace
   * package, so it needs saying explicitly; without this the SPA suites fail to
   * resolve their own services and hooks, which reads as a broken import rather
   * than a missing alias.
   *
   * Applied to both projects: a suite resolving the SPA differently from its
   * sibling fails like a product bug, and Vitest projects do not inherit the
   * root `resolve`.
   */
  aliases: [
    {
      find: '@image-host/web',
      replacement: fileURLToPath(new URL('apps/web/src', import.meta.url)),
    },
    // The API worker, reached as a package rather than by a relative path out of
    // `test/`. The factory generates aliases only for `packages/*`, so an app is
    // not covered without saying so — same reasoning as `@image-host/web` above.
    {
      find: '@image-host/api',
      replacement: fileURLToPath(new URL('apps/api/src', import.meta.url)),
    },
    // `@/*` inside `apps/api` (its tsconfig maps it to its own `src/`). The SPA
    // imports nothing through `@/`, so this cannot shadow it.
    {
      find: '@/',
      replacement: `${fileURLToPath(new URL('apps/api/src', import.meta.url))}/`,
    },
  ],
});
