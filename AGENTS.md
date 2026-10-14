# Image-Host

Self-hosted image host on Cloudflare Workers backed by Telegram group storage.

Users sign in with Cloudflare Zero Trust. Authenticated users upload/manage their own images. Anonymous users may only view a shared link.

## Guides

- Repo: [`docs/agents/repo/AGENTS.md`](docs/agents/repo/AGENTS.md)
- Runtime: [`docs/agents/runtime/AGENTS.md`](docs/agents/runtime/AGENTS.md)
- API: [`apps/api/AGENTS.md`](apps/api/AGENTS.md)
- Web: [`apps/web/AGENTS.md`](apps/web/AGENTS.md)
- Data: [`packages/backend-data/AGENTS.md`](packages/backend-data/AGENTS.md)

## Invariants

- Public routes never authenticate and never mutate D1.
- Upload/manage routes are Zero Trust browser routes only (`/user/*`).
- Every image is owned by the uploading user; management is owner-scoped.
- Telegram group is the only storage backend.
- Existing compatibility links (`/api/enableauthapi/tgchannel`, `/api/cfile/:name`) must keep working.
