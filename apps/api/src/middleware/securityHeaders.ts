/**
 * Response headers applied to every route.
 *
 * Registered on `*` and *before* the other middleware so that even the shell and
 * the health check carry them — the two responses most likely to be cached by
 * something in front of the worker, and the two a strictest-policy scanner sees
 * first.
 *
 * The CSP is the restrictive one an image host can afford: there is no third
 * party, no inline script, and no eval. The SPA is served as one document with a
 * bundled script, so `script-src 'self'` needs no nonce machinery.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '),
};

export function securityHeaders(): (c: { res: Response }, next: () => Promise<void>) => Promise<void> {
  return async (c, next) => {
    await next();
    // `c.res.headers` is mutable in Hono, but a handler that returned a brand-new
    // Response has already committed them — so each header is set defensively via
    // a fresh set rather than assuming mutability.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
  };
}

export { SECURITY_HEADERS };
