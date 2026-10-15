/**
 * The service environment, narrowed to what the domain services read.
 *
 * A binding present in the wrangler template, the generated
 * `worker-configuration.d.ts`, `ServiceEnv` and the route modules is four places
 * to update, and a binding missing from one of them is how a deploy ships
 * something that fails only at runtime. `ServiceEnv` is the one that is
 * checked-in, so it is where the other three have to be kept honest.
 *
 * ### Why nothing catches a disagreement here
 *
 * `ServiceEnv` is hand-written rather than derived from the generated
 * `worker-configuration.d.ts`, because that file is gitignored and deriving from
 * it would fail typecheck in a fresh clone until `postinstall` happened to run.
 * The cost of that choice is that **no gate compares the two**: `Env extends
 * ServiceEnv`, while `pnpm run typegen` augments `CloudflareEnv`, so the
 * generated binding types never meet the ones written here. `scripts/` does not
 * read `ServiceEnv` either.
 *
 * That is not a hypothetical gap. `IMAGE_HOST_SECRETS` was declared
 * `Record<string, string>`, because that is what reading a secret synchronously
 * looks like — and the type it actually has is `SecretsStoreSecret`, an object
 * whose only member is an async `get()` and which carries no readable
 * properties. Every property access on it is `undefined`, so the token was
 * `undefined` on every request in production while the unit suite stayed green
 * against a `fakeEnv` that faked the shape that does not exist.
 *
 * **A binding's type here is a claim about the runtime, and nothing verifies
 * it.** Declare the generated type, not the convenient one.
 */
export interface ServiceEnv {
  /**
  D1. The `images` and `image_views` tables.
  */
  ImageHostDB: D1Database;
  /**
  Secrets Store entry holding the Telegram bot token.

  `SecretsStoreSecret` and not a record: the binding hands over one secret
  through `await env.IMAGE_HOST_SECRETS.get()` and exposes no readable
  properties, so there is nothing on it to read the token *from*.
  */
  IMAGE_HOST_SECRETS: SecretsStoreSecret;
  /**
  The group the files live in. Not secret, so an ordinary var.
  */
  TELEGRAM_CHAT_ID: string;
  ENVIRONMENT?: string;
  DEMO_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  MAX_UPLOAD_BYTES?: string;
  /**
  How many days of `image_views` the daily prune keeps. Consumed by
  `ViewLogRetentionService`; a non-positive value means the same as unset, and
  the shared default applies.
  */
  VIEW_LOG_RETENTION_DAYS?: string;
  LOG_LEVEL?: string;
}
