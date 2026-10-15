import { createPagesProxy } from '@rexezuge/tooling/functions/pages-proxy';

/**
 * Pages → Worker proxy.
 *
 * The Pages deployment serves the SPA's static files directly and forwards every
 * dynamic path here, so the Worker is the only place routing, auth, and the API
 * live. The forwarded headers carry the *original* request metadata, which the
 * Worker reads for view telemetry.
 *
 * The kit's factory is strictly stricter than a hand-rolled copy: it deletes every
 * forwarding header the client could have set — `X-Real-Ip`, `True-Client-IP`,
 * `Forwarded`, and the `X-Forwarded-*` family — before writing the three the Worker
 * trusts. Every one of those names a *client's* claim about the network path, and
 * the Worker is the only party that can know the real one; a pass-through copy
 * would let a client forge the IP recorded against a view.
 *
 * The body guard and `duplex: 'half'` are the factory's too: without the latter
 * every non-GET proxied request fails with a 500 from `new Request`.
 */
export const proxyToApi = createPagesProxy();

export const onRequest = proxyToApi;
