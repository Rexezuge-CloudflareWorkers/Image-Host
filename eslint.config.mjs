import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

/**
 * The family's converged lint configuration.
 *
 * `projectDirs` names only the four package layers this repository actually has.
 * The factory's default set also carries entries for `apps/api`, `apps/background`
 * and `apps/web`, and it filters the canonical table down to the named
 * directories — so naming a directory installs that directory's last row only.
 * The two boundaries `apps/api` needs are supplied by `extraLayers` below,
 * merged into a single entry for the same reason.
 */
export default [
  ...defineRepoLintConfig({
    scope: '@image-host',

    /**
     * The four package layers, in dependency order.
     *
     * `backend-runtime` is absent on purpose: this repository keeps its
     * configuration reading in `backend-services`, which sits above
     * `backend-data` in the same layer, so there is nothing for a separate
     * runtime layer to isolate.
     */
    projectDirs: ['packages/shared', 'packages/backend-data', 'packages/provider-clients', 'packages/backend-services'],

    tsconfigRootDir: import.meta.dirname,

    /**
     * Un-ignore `scripts/**`, which the factory ignores.
     *
     * The factory treats `scripts/**` as build-time tooling that need not
     * typecheck strictly — a reasonable default for a kit, and the wrong one
     * here: `scripts/migrations/verify-migrations.ts` is written in TypeScript
     * *specifically so the script is covered by the repo's lint and typecheck
     * rules*, and it is the gate that decides whether a migration may be edited.
     *
     * A negated pattern is the only way back: a global ignore cannot be undone by
     * a later config object, so the entry has to be added to the same list.
     */
    extraIgnores: ['!scripts/**'],

    /**
     * The two `apps/api` boundaries, as one entry.
     *
     * `apps/api` must not reach the Telegram provider client or a DAO directly,
     * and route modules must not import DAOs at all — type-only imports included,
     * except that a model may be typed against a DAO shape.
     *
     * They are one entry because two entries for one directory would install only
     * the second, and because `allowTypeImports` is a property of a **group**, not
     * of a layer.
     *
     * The DAO ban is scoped to `@image-host/backend-data/dao` rather than the whole
     * `backend-data` package, which is what the canonical entry uses: route
     * presenters legitimately import `backend-data/utils/*` outside `routes/`, and
     * neither is a DAO.
     */
    extraLayers: [
      {
        dir: 'apps/api',
        ban: ['@image-host/provider-clients', '@image-host/backend-data/dao'],
        allowTypeImports: true,
        message:
          'apps/api must not import provider-clients or a DAO directly — add a method to the owning backend-services domain service and call it through the request scope. Type-only imports are allowed.',
      },
    ],
  }),

  /**
   * The kit deliberately leaves `react-hooks` to the consumer. It is the one
   * plugin whose rules are about a framework rather than about code quality, and
   * shipping a preset for it would mean either a peer dependency every consumer
   * must satisfy or a config entry that throws when the plugin is absent. These
   * four lines are the answer.
   */
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];
