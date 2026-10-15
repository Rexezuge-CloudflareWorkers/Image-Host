/**
 * The single definition of the Telegram storage coordinates.
 *
 * These names appear in four places — the wrangler template, the Secrets Store,
 * `ServiceEnv` and the composition root — and the binding name is the one the
 * error messages have to quote. Keeping it here means a rename is a rename rather
 * than a grep, and the template remains the only place that cannot import this
 * file (it is JSONC).
 */

/**
 * The Secrets Store binding that carries the bot token.
 */
export const TELEGRAM_SECRETS_BINDING = 'IMAGE_HOST_SECRETS';

/**
 * The Secrets Store entry the binding points at.
 *
 * Named in errors because the binding carries no readable properties: a failed
 * `get()` can only be reported as "this secret, in this binding", since there is
 * no value on the binding itself to name.
 */
export const TELEGRAM_TOKEN_SECRET = 'image-host-telegram-bot-token';

/**
 * The var carrying the group id. Not secret, so an ordinary var rather than a
 * Secrets Store entry.
 */
export const TELEGRAM_CHAT_ID_VAR = 'TELEGRAM_CHAT_ID';
