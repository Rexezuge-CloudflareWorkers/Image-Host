# scripts/

Repo tooling, grouped by who runs it. Every script is TypeScript and is covered
by `pnpm run lint` and `pnpm run typecheck:scripts`.

| Directory     | Runs from           | Purpose                                                              |
| ------------- | ------------------- | -------------------------------------------------------------------- |
| `lib/`        | imported            | Reusable helpers. No side effects on import.                         |
| `build/`      | `pnpm install`      | Keeps a fresh clone typecheckable before the first build.            |
| `deploy/`     | `deploy-worker` job | Materialize `wrangler.jsonc`, provision its resources and secrets.   |
| `migrations/` | a human, or CI      | The migration checksum lock. See `../docs/agents/runtime/AGENTS.md`. |

## What was ported from AWS-AccessBridge, and what changed

Nine files are byte-identical to AWS-AccessBridge's copies. Nothing in them is
AWS-specific — `check-god-files.mjs`, `spa-shell-checks.ts`,
`verify-spa-shell.ts`, `lock-check.ts`, `verify-migrations.ts`,
`wrangler-table.ts`, and the three generic `lib/wrangler-config/` modules are the
family's converged versions, and re-deriving them here would be the drift the
convergence exists to prevent.

Four were adapted, each for a named reason:

| File                                | Change                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `lib/wrangler-config/types.ts`      | `DEFAULT_WORKER_NAME` → `image-host`; `DEFAULT_KV_NAMESPACE_NAMES` emptied (no KV here)                  |
| `lib/wrangler-config/resources.ts`  | Comment only — the AWS binding name in a rationale                                                       |
| `build/ensure-spa-shell-stub.ts`    | Stub title and `<div id="root">` text                                                                    |
| `deploy/prepare-wrangler-config.ts` | Dropped the `created` step output — its only consumer was `backup-d1.yml`, which this repo does not ship |

`deploy/init-secrets.ts` was rewritten rather than edited; its header states why.

## Entrypoint vs module convention

Followed across the sibling repos, so `scripts/**` needs no ESLint rule overrides:

- An **entrypoint** starts with `#!`, runs at top level, and exports nothing.
  `unicorn/no-exports-in-scripts` fires only on files whose first line is `#!`, so
  keeping exports out of entrypoints is what lets these files be linted at all.
- A **module** has no `#!` and exports freely. Testable guards and shared helpers
  live here, and are imported by both the entrypoint and `test/scripts/`.

`prepare-wrangler-config.ts` is the clearest example: it is five lines of ordered
calls into `lib/wrangler-config/`.

## lib/

| Module                                 | Contents                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `wrangler-config/types.ts`             | `wrangler.jsonc` paths, placeholder ids (`DEFAULT_UUID`, `DEFAULT_HEX_ID`), config interfaces.             |
| `wrangler-config/cli.ts`               | `runWrangler`, `parseJsonArray`.                                                                           |
| `wrangler-config/patches.ts`           | Read/rewrite `wrangler.jsonc`, `WRANGLER_JSONC` / `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON`.      |
| `wrangler-config/resources.ts`         | Create missing D1 / Secrets Store resources and patch their ids in.                                        |
| `wrangler-config/template-coverage.ts` | Requires every binding name and `vars` key the template declares to be present in the materialized config. |
| `wrangler-table.ts`                    | Parses the `cli-table3` output `wrangler secrets-store` prints.                                            |

**The coverage check is structural, not a version integer.** It requires every
binding name and `vars` key the template declares to be _present_ in the
materialized `wrangler.jsonc` — never equal, since a deployment fills
`POLICY_AUD`/`TEAM_DOMAIN` with its own values. It runs _after_ both patches (so a
var supplied by `WRANGLER_VARS_PATCH_JSON` counts) and _before_ provisioning, so a
config that cannot deploy never creates a D1 database or a Secrets Store on the way
to finding out.

## Running one locally

CI entrypoints are runnable from a local shell with the same flags Actions uses:

```bash
pnpm exec tsx scripts/deploy/prepare-wrangler-config.ts
pnpm run validate:migrations
```

After adding a migration, `pnpm run migrations:lock` records it. It is add-only for
incremental migrations and refreshes the squashed baseline, so it will not adopt the
new digest of one that has already been applied.

`validate:migrations` is `tsx`, not `node`: the entrypoint imports a sibling module
with an extensionless relative path, which Node's ESM resolver will not resolve.

There is no committed `wrangler.jsonc`. `scripts/deploy/prepare-wrangler-config.ts`
creates it, and `deploy/` expects it to exist.

## Adding a script

1. Put pure logic in a module next to the entrypoint, or in `lib/` if more than one
   script needs it.
2. Give the entrypoint a `#!` and no exports.
3. Cover the module with a test in `test/scripts/`.
4. Export nothing that only the entrypoint needs. If a test needs it, that is a
   signal the logic belongs in the module.
