-- Images and their anonymous view log.
--
-- Every row has exactly one owner. There is no nullable `owner_email` and no
-- `compat_file_id`: the predecessor this replaces had a shared table keyed by a
-- Telegram `file_id` in the public URL, and carrying any of that forward would
-- mean rows nobody owns and therefore rows nobody can delete.

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The public share-link identifier. UNIQUE, and the only thing in the URL.
  -- 16 characters from a 62-character alphabet (~95 bits), so the link is a
  -- capability: guessing another image's slug is not feasible.
  slug TEXT NOT NULL UNIQUE,

  -- The Zero Trust address that uploaded it. Every read and write on this table
  -- is scoped by it, which is what makes "each user manages their own files" a
  -- property of the query rather than of a route remembering to check.
  owner_email TEXT NOT NULL,

  -- The Telegram handle for the stored bytes. Deliberately never presented by the
  -- API: exposing it would let a reader build a direct Telegram URL and bypass
  -- this host's block and delete state entirely.
  file_id TEXT NOT NULL,

  -- The message id in the group, which is what `deleteMessage` needs. `file_id`
  -- does not contain it, and without it a delete is permanently metadata-only —
  -- the exact position the predecessor was stuck in for its whole life.
  telegram_message_id INTEGER,

  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,

  -- Soft delete. The share link answers 404 from here rather than serving an
  -- image the owner asked to be removed, and the row stays as the record of what
  -- used to live in the group.
  deleted_at TEXT,

  blocked INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_owner ON images (owner_email, id DESC);
CREATE INDEX IF NOT EXISTS idx_images_deleted ON images (deleted_at);

CREATE TABLE IF NOT EXISTS image_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL,
  referer TEXT,
  ip TEXT,
  viewed_at TEXT NOT NULL,
  FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_views_image ON image_views (image_id, id DESC);