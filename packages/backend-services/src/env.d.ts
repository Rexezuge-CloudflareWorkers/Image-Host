import type { ServiceEnv } from './composition/ServiceEnv';

/**
 * The checked-in binding source of truth.
 *
 * A binding has to appear in four places: this file, `apps/api/wrangler.template.jsonc`,
 * the generated root `worker-configuration.d.ts`, and `ServiceEnv`. This is the
 * one that is checked in, and `pnpm run typegen` regenerates the other two from
 * the template — so a binding present in three of the four is the failure mode
 * worth avoiding, and this file is what makes it visible at typecheck time.
 *
 * Deliberately *not* derived from the generated `worker-configuration.d.ts`:
 * that file is gitignored, so deriving from it would make every fresh clone fail
 * typecheck until `postinstall` happened to run.
 */
declare global {
  // Declaration merging, not an alias: `interface Env extends ServiceEnv {}` is how
  // a *global* `Env` gets `ServiceEnv`'s members while remaining augmentable by
  // `worker-configuration.d.ts`. A type alias cannot be augmented, and
  // `interface Env extends ServiceEnv {}` written as a type alias is the error this
  // rule reports.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merging pattern
  interface Env extends ServiceEnv {}
}

export {};
