import type { D1Like, ImageRow } from '../types';
import type { CreateImageInput } from '@image-host/shared';

export async function createImage(db: D1Like, input: CreateImageInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO images (slug, owner_email, file_id, file_name, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.slug ?? null, input.ownerEmail, input.fileId, input.fileName, input.mimeType, input.sizeBytes ?? null, new Date().toISOString())
    .run();
  // D1 does not return lastRowId in run(); fetch by slug below in caller if needed.
  return result.success ? 1 : 0;
}

export async function insertImage(
  db: D1Like,
  slug: string,
  ownerEmail: string,
  fileId: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (slug, owner_email, file_id, file_name, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(slug, ownerEmail, fileId, fileName, mimeType, sizeBytes, new Date().toISOString())
    .run();
}

export async function getImageBySlug(db: D1Like, slug: string): Promise<ImageRow | null> {
  return await db.prepare(`SELECT * FROM images WHERE slug = ?`).bind(slug).first<ImageRow>();
}

export async function listImagesByOwner(
  db: D1Like,
  ownerEmail: string,
  page = 0,
  pageSize = 20,
  query?: string,
): Promise<{ rows: ImageRow[]; total: number }> {
  const offset = page * pageSize;
  if (query) {
    const { results } = await db
      .prepare(`SELECT * FROM images WHERE owner_email = ? AND deleted_at IS NULL AND file_name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(ownerEmail, `%${query}%`, pageSize, offset)
      .all<ImageRow>();
    const total = await db
      .prepare(`SELECT COUNT(*) as total FROM images WHERE owner_email = ? AND deleted_at IS NULL AND file_name LIKE ?`)
      .bind(ownerEmail, `%${query}%`)
      .first<{ total: number }>();
    return { rows: results, total: total?.total ?? 0 };
  }
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE owner_email = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(ownerEmail, pageSize, offset)
    .all<ImageRow>();
  const total = await db
    .prepare(`SELECT COUNT(*) as total FROM images WHERE owner_email = ? AND deleted_at IS NULL`)
    .bind(ownerEmail)
    .first<{ total: number }>();
  return { rows: results, total: total?.total ?? 0 };
}

export async function softDeleteImage(db: D1Like, id: number, ownerEmail: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE images SET deleted_at = ? WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`)
    .bind(new Date().toISOString(), id, ownerEmail)
    .run();
  return result.success;
}

export async function incrementViewCount(db: D1Like, slug: string): Promise<void> {
  await db.prepare(`UPDATE images SET view_count = view_count + 1 WHERE slug = ?`).bind(slug).run();
}

export async function blockImage(db: D1Like, id: number, ownerEmail: string, blocked: boolean): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE images SET blocked = ? WHERE id = ? AND owner_email = ?`)
    .bind(blocked ? 1 : 0, id, ownerEmail)
    .run();
  return result.success;
}