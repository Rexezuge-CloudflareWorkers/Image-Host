/**
 * The service environment, narrowed to what the domain services read.
 *
 * A binding present in the wrangler template, the generated
 * `worker-configuration.d.ts`, `ServiceEnv` and the route modules is four places
 * to update, and a binding missing from one of them is how a deploy ships
 * something that fails only at runtime. `ServiceEnv` is the one that is
 * checked-in, and the others are checked against it by `pnpm run typecheck`.
 */
export interface ServiceEnv {
  /**
  D1. The `images` and `image_views` tables.
  */
  ImageHostDB: D1Database;
  /**
  Secrets Store entry holding the Telegram bot token.
  */
  IMAGE_HOST_SECRETS: Record<string, string>;
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
  LOG_LEVEL?: string;
}
