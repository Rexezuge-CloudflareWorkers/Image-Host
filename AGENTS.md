# Image-Host

Self-hosted image host on Cloudflare Workers backed by Telegram group storage.

Users sign in with Cloudflare Zero Trust. Authenticated users upload/manage their own images. Anonymous users may only view a shared link.

## Guides

- Repo: [`docs/agents/repo/AGENTS.md`](docs/agents/repo/AGENTS.md)
- Runtime: [`docs/agents/runtime/AGENTS.md`](docs/agents/runtime/AGENTS.md)
- API: [`apps/api/AGENTS.md`](apps/api/AGENTS.md)
- Web: [`apps/web/AGENTS.md`](apps/web/AGENTS.md)
- Data: [`packages/backend-data/AGENTS.md`](packages/backend-data/AGENTS.md)
- Scripts: [`scripts/README.md`](scripts/README.md)

## Invariants

- `/` serves the same SPA document to everyone. Auth state is discovered by probing `GET /user/me`, never by the server choosing between documents.
- `/user/*` is the only authenticated surface. It sits behind Cloudflare Access; `/i/:slug` and everything else stay outside it.
- Every image has exactly one owner, and ownership lives in the `WHERE` clause of every query — there is no load-then-compare path.
- Anonymous reads never mutate user-owned data. The one write on a public route is view telemetry, fire-and-forget inside `waitUntil`.
- Telegram group is the only storage backend, and `telegram_message_id` is stored so a delete can actually remove the message.
- **There is no compatibility surface.** The predecessor's `/api/cfile/:name` and `/api/enableauthapi/tgchannel` routes are retired; links from that deployment are expected to 404.
