import { ServiceError, DefaultInternalServerError } from '@rexezuge/errors';
import { log } from '@image-host/shared/utils/Logger';

/**
 * Maps a caught value to the family's `{Exception:{Type,Message}}` envelope.
 *
 * Three cases, and the distinction between the second and third is the whole
 * point of the function:
 *
 * 1. A `ServiceError` maps to its own status and type. `toErrorResponse()` already
 *    substitutes a generic message for anything non-exposed, so a 500's internals
 *    are not pushed to the client even though the thrown object carries them.
 * 2. Anything else is logged and answered as a 500 with a generic message —
 *    never the thrown text, which is where D1 and `wrangler` internals live.
 * 3. An *already-exposed* `ServiceError` is logged at `warn`, not `error`: a 404
 *    on somebody's stale link is normal traffic, and logging it at `error` trains
 *    everyone to ignore the error log.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ServiceError) {
    const { status, body } = error.toErrorResponse();
    if (status >= 500) {
      log.error('Request failed', { type: error.type, message: error.message });
    } else {
      log.warn('Request rejected', { type: error.type, status });
    }
    return Response.json(body, { status });
  }

  log.error('Unhandled error', { error: error instanceof Error ? error.message : String(error) });
  const { status, body } = DefaultInternalServerError.toErrorResponse();
  return Response.json(body, { status });
}

/**
 * Runs a handler and converts anything it throws into a response.
 *
 * Every route goes through this rather than a bare `try`/`catch`, so no route can
 * forget the mask — which is the only reason the mask is trustworthy.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}
