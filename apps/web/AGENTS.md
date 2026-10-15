# Image-Host — Web SPA

Scope: `apps/web/**`. Parent index: [`../../AGENTS.md`](../../AGENTS.md). The route surfaces the SPA talks to: [`../api/AGENTS.md`](../api/AGENTS.md).

## One document, three renders

The Worker serves the same shell to everyone, so the client decides what to show. `App.tsx` renders on one probe:

| `useCurrentUser().authorized` | Renders                              |
| ----------------------------- | ------------------------------------ |
| `null`                        | nothing but "Checking your session…" |
| `false`                       | `PublicView` — the landing page      |
| `true`                        | `ConsoleView` — upload + library     |

**The third state is the point.** With a boolean, anything rendering on `authorized === false` shows the anonymous view for as long as the probe takes and then swaps it for the console — a flash of the wrong page on every authenticated load. `null` is what lets both views hold back until the answer is known.

The sign-in affordance points at `/user/`, not `/`. `/user/` is the path Cloudflare Access is configured to intercept, so navigating there starts the login flow; `/` deliberately does not.

## The probe is "did `GET /user/me` return 200 JSON"

Everything else means **not** authenticated: a 401, a 302 to the Access login page, or the login page's HTML.

That last case is the subtle one. `fetch` follows redirects, so an Access-gated `/user/me` returns the login page's **HTML with a 200**. `lib/api.ts`'s `extractErrorMessage` has a dedicated non-JSON `catch` branch for exactly this — without it, the login page's markup would be truncated into an error string and rendered. Any parse failure is treated as "not signed in", which is the only reading that is safe.

## The probe is deduplicated

`loadCurrentUser` memoizes the in-flight promise behind a **holder object** rather than a reassigned binding: React 19's StrictMode mounts effects twice, so without this the console would issue two `GET /user/me` requests on every load and render on whichever resolved last. The holder is cleared on settle so an explicit reload re-fetches.

## Conventions

- **Client-side routes under `/user/`; everything else is bytes or 404.** No client route is a data path, so the Worker's catch-all cannot serve HTML where a share link should stream.
- **No optimistic mutations.** `delete` and `block` await the server then reload. An optimistic delete the server rejects — and it can, with a 404 — would leave a row that no longer exists.
- **A 401 anywhere sends the user to `/user/`.** The session can lapse while the console is open, and the probe is the only thing that can move the app back to the anonymous view.
- **The multipart field name comes from `@image-host/shared/schema`.** The client and the server read the same constant, so they cannot drift into a 400 that only reproduces in a browser.
- English UI text uses Title Case.

## Build

`vite.config.ts` pins an **absolute `root`** for `spaShellEmbedPlugin`. The plugin defaults to `process.cwd()`, which `pnpm --filter` sets to `apps/web` — the shell would be written to `apps/web/apps/api/...` and the build would still succeed. See [`../../docs/agents/runtime/AGENTS.md`](../../docs/agents/runtime/AGENTS.md).

The dev server proxies both `/user` and `/i` to `http://localhost:8787`. The `/i` entry matters as much as the API one: an `<img src="/i/...">` pointing at the dev server's own port would 404 and the previews would render as broken.

## Testing

Suites live in `test/web/**` (jsdom) and import through the `@image-host/web/*` alias. `useCurrentUser`'s `active` flag guards against setting state after unmount, which under StrictMode would warn and can resurrect stale rows.
