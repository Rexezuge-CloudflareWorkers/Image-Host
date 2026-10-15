# Image-Host — Data Layer

Scope: `packages/backend-data/**`. Parent index: [`../../../AGENTS.md`](../../../AGENTS.md). Schema and migrations: [`../../docs/agents/runtime/AGENTS.md`](../../docs/agents/runtime/AGENTS.md).

`ImagesDAO` (the `images` table) and `ImageViewsDAO` (`image_views`), both on `@rexezuge/d1`'s `BaseDAO`, plus the row→API presenter.

## Ownership is in the WHERE clause

`getOwned`, `getOwnedBySlug`, `softDeleteOwned` and `setBlockedOwned` all carry `owner_email = ?`. **There is no "load then compare" path** — a route that fetched by id and compared in JavaScript would be one refactor away from deleting somebody else's image, and nothing in the type system or the tests would catch it.

A write reports `false` when no live row matched, which is the caller's 404 — and is also the answer for a row owned by somebody else. Distinguishing them would turn the endpoint into an oracle for probing other users' image ids.

## Things that look like bugs and are not

**`insert` takes a slug _factory_, not a slug, and returns the slug it used.** The return value exists so the caller re-reads _by that slug_; reading back "the newest row for this owner" is wrong the moment one account uploads twice at the same instant — both requests would resolve to whichever row committed last, and one user would receive the other's share link. This was a real bug in an earlier draft of `ImageService`, caught by writing the read-back this way.

The retry is bounded at one attempt. Past that the constraint violation propagates — an unbounded loop would hang a request on a factory that keeps returning the same value. `isUniqueViolation` requires the **column name** in the message, so a different unique violation is not misread as a slug collision.

**`insert` takes a `NewImage`, not an `Omit<ImageRow, …>`.** `id`, `view_count`, `blocked` and `deleted_at` are assigned by SQLite, and listing them as required input would invite a caller to pass `deleted_at: null` by hand — indistinguishable from a soft-delete at the call site.

**`file_id` is not `UNIQUE`.** Telegram reissuing an id must not break an unrelated upload, so two rows may legitimately share one. The slug is the uniqueness constraint.

**`SELECT COUNT(*) AS count` — the alias is load-bearing.** `BaseDAO.count()` reads the column named `count`; a bare `SELECT COUNT(*)` yields one named `COUNT(*)`, so the lookup returns `undefined` and **every list reports `total: 0` alongside correct rows**. The integration suite caught this, and it is invisible in a stubbed test.

**`deleted_at IS NULL` is in both the page query and the count.** Counting soft-deleted rows would leave the SPA promising more images than it can page through, forever.

## `escapeLike`

The search path escapes `\` `%` and `_` with `ESCAPE '\'` stated in the query. Without both, `%` matches every row — and `a_b` matches `axb`, which is the worse of the two, because a user searching for a filename with an underscore silently gets a superset.

## View telemetry

`recordAndCount` bumps `view_count` **and** appends the log row, with `AND deleted_at IS NULL` on the update: a share link that 404s must not keep reporting traffic.

Every method here runs inside `waitUntil` on a **public** route, so a failure must never surface to the viewer. The route swallows the rejection — which is why this DAO is not itself defensive.

`listForImage` is owner-scoped through a join on `images`, and is never public: `referer` and `ip` are personal data.

`pruneOlderThanBatch` is the retention half, run daily by `ViewLogRetentionService` under a cron trigger. It delegates to `BaseDAO.deleteOlderThan` — the family-wide helper this pattern was converged from — which allow-lists the identifiers and expresses the batch boundary as a subquery `LIMIT`, because D1's SQLite build has no `DELETE ... LIMIT`. `viewed_at` is a fixed-format UTC ISO string on every row, so the cutoff compares correctly as a string. The returned count is load-bearing: the service loops until a batch comes back short, so a silent `0` would let the table grow while the prune reported success.

**The prune never touches `view_count`.** The counter is the owner-facing lifetime figure; the log is a rolling window behind it, and rows ageing out of that window must not rewrite history.

## `presentImage`

`owner_email` and `file_id` are **deliberately not presented.** An owner's own listing does not need the address echoed back, and `file_id` is the Telegram handle — exposing it would let a reader construct a direct Telegram URL and bypass this host's block and delete state entirely.

## Testing

`test/integration/**` runs these against a real D1 under workerd. The node suite stubs the database, which is exactly why `LIKE` escaping, `LIMIT ? OFFSET ?` binding, `meta.changes` on an ownership-scoped write, and the UNIQUE constraint the retry depends on are only checkable there.

Never hardcode `id: 1` in those tests: `resetDatabase` issues `DELETE`, which does not reset SQLite's `AUTOINCREMENT` counter, so ids climb across a file. Read the id back by slug — which is what production code does anyway.
