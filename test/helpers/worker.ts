/**
 * Test helpers for driving the worker.
 *
 * Two things live here rather than in each suite:
 *
 * - `testContext()` — a partial `ExecutionContext`. Only `waitUntil` matters (the
 *   share route uses it for view telemetry), and it must be cast through
 *   `unknown` because the real interface carries `props` and a `passThroughOnException`
 *   overload this suite has no use for.
 * - `json<T>()` — `Response.json()` is typed `Promise<unknown>`, so every
 *   `await response.json()` in a route suite is untyped. Naming the shape at the
 *   call site is what turns "Property 'image' does not exist on type 'unknown'"
 *   into a real assertion.
 */

/**
A minimal `ExecutionContext`. `waitUntil` is a no-op that records nothing.
*/
export function testContext(): ExecutionContext {
  const context = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
  return context as unknown as ExecutionContext;
}

/**
`Response.json()`, typed.
*/
export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
The `{ Exception: { Type, Message } }` error envelope.
*/
export interface ErrorEnvelope {
  Exception: { Type: string; Message: string };
}
