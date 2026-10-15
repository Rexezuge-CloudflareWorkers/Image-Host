-- Retention index for the scheduled view-log prune.
--
-- The prune deletes `image_views` rows older than a cutoff, one batch at a time:
-- `DELETE FROM image_views WHERE id IN (SELECT id FROM image_views WHERE viewed_at < ? LIMIT ?)`.
-- The existing `(image_id, id DESC)` index serves the owner's view-log read, not
-- this predicate — so without an index on `viewed_at`, every batch scans the
-- table looking for old rows, and the steady state of a healthy prune is "almost
-- every row is new", which is the worst case for that scan.
--
-- `viewed_at` is a fixed-format UTC ISO-8601 string (`new Date().toISOString()`
-- from one code path), so comparing it against the cutoff lexicographically is
-- comparing it chronologically.

CREATE INDEX IF NOT EXISTS idx_image_views_viewed_at ON image_views (viewed_at);
