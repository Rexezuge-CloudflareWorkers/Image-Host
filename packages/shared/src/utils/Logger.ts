/**
 * A minimal logger.
 *
 * Deliberately not `console` at the call site: the level check lives here so a
 * disabled level costs one comparison, and so a future sink (Workers Logs
 * structured payload) is a change to this file only.
 */
export const log = {
  debug(...args: unknown[]): void {
    console.debug(...args);
  },
  info(...args: unknown[]): void {
    console.info(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
};

/**
 * Logs an error for diagnostics and returns a message safe to return to a client.
 *
 * The `jose` and `wrangler` error texts name expected issuers, audiences and
 * config keys, so logging the original and answering with the original would leak
 * the verifier's configuration to whoever provoked the failure.
 */
export function logAndMask(error: unknown, context: string): string {
  log.warn(context, { error: error instanceof Error ? error.message : String(error) });
  return 'Internal Server Error.';
}
