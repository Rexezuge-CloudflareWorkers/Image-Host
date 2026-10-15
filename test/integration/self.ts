/**
 * The workerd entrypoint for the integration suite.
 *
 * Deliberately empty. It exists so `wrangler.test.jsonc` has a `main` to point
 * at — the pool needs a worker to build even when every test exercises the DAOs
 * through `env` rather than through a fetch handler.
 */
export default {
  fetch: (): Response => new Response('ok'),
};

/**
Re-exported so a suite can assert the D1 binding resolved.
*/

export { env } from 'cloudflare:test';
