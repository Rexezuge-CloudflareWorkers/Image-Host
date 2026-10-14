CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  owner_email TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_owner ON images (owner_email);
CREATE INDEX IF NOT EXISTS idx_images_slug ON images (slug);

CREATE TABLE IF NOT EXISTS image_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id INTEGER NOT NULL,
  referer TEXT,
  ip TEXT,
  viewed_at TEXT NOT NULL,
  FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_views_image ON image_views (image_id);