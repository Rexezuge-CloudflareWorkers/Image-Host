import react from '@vitejs/plugin-react';
import { pathToFileURL } from 'node:url';
import { defineWebViteConfig } from '@rexezuge/tooling/vite';

/**
 * `apps/web`, as an absolute file URL.
 *
 * The kit's `spaShellEmbedPlugin` resolves its paths against `process.cwd()` when
 * no `root` is given. `pnpm --filter @image-host/web build` runs the script with
 * the *package* directory as cwd, so a root-relative `path` would write the shell
 * to `apps/web/apps/api/src/generated/spa-shell.ts` — the build would succeed, the
 * worker would keep serving the `postinstall` stub, and `verify:spa-shell` would
 * fail on a file that does exist. AWS-AccessBridge and Edge-Git both hand-roll
 * this plugin anchored to `import.meta.dirname` for the same reason; pinning
 * `root` is the equivalent fix that keeps the converged plugin.
 *
 * Absolute, because `toUrl` resolves a relative path against `process.cwd()` —
 * which is the very thing being pinned.
 */
const APP_WEB = pathToFileURL(import.meta.dirname).href;

export default defineWebViteConfig({
  plugins: [react()],

  // Both surfaces are proxied in dev: `/user/*` is the authenticated API and
  // `/i/*` is the share link. Proxying the share link matters as much as the API
  // one — an `<img src="/i/...">` pointing at the dev server's own port would 404,
  // and the console's image previews would silently render as broken.
  proxy: {
    '/user': { target: 'http://localhost:8787', changeOrigin: true },
    '/i': { target: 'http://localhost:8787', changeOrigin: true },
  },

  // `distIndex` is left at its default, which resolves to `apps/web/dist/index.html`
  // under this root — the one the build itself produces.
  spaShell: {
    root: APP_WEB,
    path: '../api/src/generated/spa-shell.ts',
  },
});
