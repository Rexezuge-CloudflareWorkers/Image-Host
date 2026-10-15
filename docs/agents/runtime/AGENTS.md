# Image-Host — Runtime And Configuration

Scope: Wrangler bindings, build output, migrations, env vars. Parent index: [`../../../AGENTS.md`](../../../AGENTS.md). Workspace layout and the layer table: [`../repo/AGENTS.md`](../repo/AGENTS.md).

## Two deployment targets

| Target       | Name             | Config                             | Serves                                                               |
| ------------ | ---------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Worker (API) | `image-host`     | `apps/api/wrangler.template.jsonc` | `/api`-ish JSON, `/i/:slug` bytes, and the SPA shell                 |
| Pages (SPA)  | `image-host-web` | `apps/web/wrangler.template.jsonc` | `apps/web/dist` static assets; everything else proxies to the Worker |

Both templates are copied to a gitignored `wrangler.jsonc` per deployer. The Worker is materialized by `scripts/deploy/prepare-wrangler-config.ts` (writes `WRANGLER_JSONC` or falls back to copying the template; `WRANGLER_PATCH_JSON` top-level merge + `WRANGLER_VARS_PATCH_JSON` vars merge, then the template-coverage check, then fills `000…` placeholder ids and auto-provisions the D1 database and Secrets Store).

`functions/[[path]].ts` is the Pages entrypoint: `createPagesProxy()` forwards every non-static path to the Worker over the `API_WORKER` service binding. The factory deletes every forwarding header the client could have set (`X-Real-Ip`, `True-Client-IP`, `Forwarded`, `X-Forwarded-*`) before writing the three the Worker trusts — the Worker reads `cf-connecting-ip` for view telemetry, and a pass-through would let a client forge the IP recorded against a view.

**The custom domain should point at the Worker**, which is where `/user/*` sits behind Access. Pointing it at Pages instead also works — the proxy forwards — but then the Access policy has to cover the Pages hostname or the SPA loads with no session and every API call 401s.

## The SPA shell, and the `root` that pins it

The Worker serves the SPA from its own page-route catch-all as `SPA_HTML`, embedded from `apps/web/dist/index.html` into `apps/api/src/generated/spa-shell.ts` by the Vite `closeBundle` hook. Both are gitignored.

`apps/web/vite.config.ts` passes an **explicit absolute `root`** to `spaShellEmbedPlugin`. This is not optional. The plugin defaults to `process.cwd()`, and `pnpm --filter @image-host/web build` runs the script with the _package_ directory as cwd — so a root-relative `path` writes the shell to `apps/web/apps/api/src/generated/spa-shell.ts`. The build succeeds, the Worker keeps serving the `postinstall` stub, and the only symptom is a blank page in production. `verify:spa-shell` catches it; AWS-AccessBridge and Edge-Git hand-roll the plugin for the same reason.

`postinstall` writes a minimal stub when the file is absent, so `tsc` can resolve `SPA_HTML` in a fresh clone. **The stub is a valid file** — so `verify:spa-shell`, not `tsc`, is the gate that distinguishes a real shell from a stub one.

## Bindings

| Binding              | Kind          | Source                                    |
| -------------------- | ------------- | ----------------------------------------- |
| `ImageHostDB`        | D1            | template, `database_name: image-host-db`  |
| `IMAGE_HOST_SECRETS` | Secrets Store | template, `image-host-telegram-bot-token` |
| `TELEGRAM_CHAT_ID`   | var           | template                                  |

Vars: `ENVIRONMENT`, `DEMO_MODE`, `DEV_AUTH_EMAIL`, `POLICY_AUD`, `TEAM_DOMAIN`, `MAX_UPLOAD_BYTES`, `TELEGRAM_CHAT_ID`.

**The bot token cannot be generated.** Every other repository's secrets are AES keys and HMAC secrets — values with no canonical form, so the deploy makes them. A Telegram bot token is issued by `@BotFather`, so `scripts/deploy/init-secrets.ts` _supplies_ it from the `TG_BOT_TOKEN` repository secret instead. It is create-if-absent: an existing token is never overwritten, so a redeploy cannot invalidate a working group. An absent token is a **named failure**, not a skip — the alternative is a deploy that succeeds and an upload that 502s forever.

**`DEV_AUTH_EMAIL` is refused in production.** `ImageHostAuthService` reads it _before_ JWT verification and with no other guard, so a value promoted from `.dev.vars` would authenticate every caller as one address. It throws `InternalServerError` when `ENVIRONMENT` is exactly `production`. `isProduction` matches the literal string — not `prod`, not unset — so a staging environment still gets the bypass.

`MAX_UPLOAD_BYTES` mirrors the Telegram Bot API's own 20 MB ceiling, because `getFile` refuses to return a download URL for anything larger. A raise here without a raise there produces an upload that succeeds and can never be served again.

## Migrations

Apply with `pnpm exec wrangler d1 migrations apply image-host-db [--local|--remote]` (requires a materialized `wrangler.jsonc`, or pass `--config`). One file: `0001_init.sql`, creating `images` and `image_views`.

D1 honours neither `PRAGMA foreign_keys = off` nor `PRAGMA legacy_alter_table = on`, and `defer_foreign_keys` does not suppress the `ON DELETE CASCADE` from `image_views.image_id` — so the cascade is real, and a hard `DELETE FROM images` would drop view rows whether or not that was intended. Soft delete avoids the question entirely.

There is **no squash file**, so the migration lock's baseline exemption does not apply and every migration is immutable. See [`../repo/AGENTS.md`](../repo/AGENTS.md).

## The `sendDocument` decision

Every upload uses `sendDocument`, never `sendPhoto`. `sendPhoto` downsamples to a 2560px maximum edge and recompresses, and refuses formats it cannot represent (SVG, AVIF). This host's contract is that the bytes uploaded are the bytes served, so a transparent PNG returned as a flattened JPEG is not a smaller file — it is a corrupted one.

The cost is no inline preview in the Telegram client itself. That is an acceptable trade for a host whose product _is_ the file.

One code path also means one thing to get wrong, rather than five MIME-specific branches — of which the predecessor's was missing the `audio` case entirely, so an uploaded sound file threw a `TypeError` and returned a 500.
