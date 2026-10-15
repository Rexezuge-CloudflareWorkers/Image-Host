/**
 * The URL a `fetch` stub was called with.
 *
 * `String(input)` is the obvious one-liner and it is wrong: `input` is
 * `RequestInfo | URL`, so a `Request` stringifies to `[object Request]` and the
 * assertion silently tests the wrong string. `instanceof URL` is checked before
 * `Request` because a `URL` is not a `Request` but both expose `.url`.
 */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
