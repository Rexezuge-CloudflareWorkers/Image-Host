# Image-Host

Self-hosted image host on Cloudflare Workers. Files are stored in a Telegram group; metadata lives in D1. Users sign in with Cloudflare Zero Trust and manage their own images; anyone holding a share link can view one.

## How it works

```
Browser ──▶ Worker (image-host)          behind Cloudflare Access on /user/*
              ├─ GET /            → the SPA shell, same document for everyone
              ├─ GET /user/*      → JSON, authenticated, owner-scoped
              └─ GET /i/:slug     → image bytes, public
                   │
                   ├─ D1             ImageHostDB (images, image_views)
                   ├─ Secrets Store  IMAGE_HOST_SECRETS → await .get()
                   └─ Telegram Bot API → the group
```

The SPA is also deployed to Cloudflare Pages (`image-host-web`), which proxies every non-static path to the Worker over an `API_WORKER` service binding.

## Routes

| Route                        | Auth       | Purpose                                       |
| ---------------------------- | ---------- | --------------------------------------------- |
| `GET /`                      | none       | SPA shell — anonymous or console              |
| `GET /user`                  | none       | Redirects to `/user/`, the Access entry point |
| `GET /health`                | none       | Liveness                                      |
| `GET /i/:slug`               | none       | Image bytes                                   |
| `GET /user/me`               | Zero Trust | Client's auth probe                           |
| `GET /user/images`           | Zero Trust | List, paged, searchable                       |
| `POST /user/images`          | Zero Trust | Upload (multipart, field `file`)              |
| `DELETE /user/images/:id`    | Zero Trust | Soft delete + remove the Telegram message     |
| `PUT /user/images/:id/block` | Zero Trust | Block / unblock                               |

## Getting started

```bash
pnpm install
pnpm run checks        # typecheck, lint, god-files, migrations, SPA shell, tests
pnpm exec wrangler dev --config ./wrangler.jsonc
```

`wrangler.jsonc` is gitignored. Materialize it once with:

```bash
pnpm exec tsx scripts/deploy/prepare-wrangler-config.ts
```

Then fill in `TELEGRAM_CHAT_ID`, and put your `@BotFather` token in the Secrets Store:

```bash
TG_BOT_TOKEN=... pnpm exec tsx scripts/deploy/init-secrets.ts
```

For local development, add `DEV_AUTH_EMAIL` and `TELEGRAM_CHAT_ID` to `.dev.vars` — the bypass is refused whenever `ENVIRONMENT` is `production`.

## Deployment

| Secret                  | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deploy                                        |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy                                        |
| `TG_BOT_TOKEN`          | Supplied to the Secrets Store on first deploy |

| Variable                        | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `WRANGLER_VARS_PATCH_JSON`      | Per-environment `vars` (team domain, policy AUD, chat id) |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | Defaults to `image-host-web`                              |

## Cloudflare Zero Trust

Two things have to line up or nothing authenticates:

1. **An Access application covering `/user/*`** on the Worker hostname. `/i/:slug` and `/` must stay _outside_ it, or share links break.
2. **`TEAM_DOMAIN` and `POLICY_AUD`**, or worker-level Access. With both set the Worker verifies the `CF-Access-Jwt-Assertion` against your team's JWKS. With neither, it falls back to `ctx.access.getIdentity()` — which works if you used Cloudflare's one-click Access.

`DEV_AUTH_EMAIL` is a local-only bypass and is **refused** under `ENVIRONMENT=production`.

## Storage notes

Uploads use Telegram's `sendDocument`, never `sendPhoto`. `sendPhoto` downsamples to a 2560px maximum edge, recompresses, and refuses SVG and AVIF — for an image host that turns a transparent PNG into a corrupted one. `sendDocument` stores bytes verbatim; the cost is no inline preview inside Telegram itself.

Telegram's `getFile` refuses to return a download URL above 20 MB, so `MAX_UPLOAD_BYTES` is capped there. A raise on one without the other produces an upload that succeeds and can never be served.

## Migrating from telegraph-Image

There is **no compatibility surface**. The old `/api/cfile/:name` and `/api/enableauthapi/tgchannel` routes are retired and old links will 404. The URL scheme changed from a Telegram `file_id` to a random 16-character slug, and ownership is now recorded — which the old schema had no column for. Files already in the group are still there; only the links to them are gone.

## Documentation

- [`docs/agents/repo/AGENTS.md`](docs/agents/repo/AGENTS.md) — workspace, commands, gates
- [`docs/agents/runtime/AGENTS.md`](docs/agents/runtime/AGENTS.md) — bindings, build, migrations
- [`apps/api/AGENTS.md`](apps/api/AGENTS.md) — routes, auth, CSRF
- [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — the three-state auth probe
- [`packages/backend-data/AGENTS.md`](packages/backend-data/AGENTS.md) — DAOs and ownership
- [`scripts/README.md`](scripts/README.md) — repo tooling

## License

MIT — see [`LICENSE`](LICENSE).
