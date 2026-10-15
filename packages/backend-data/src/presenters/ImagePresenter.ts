import type { ImageRow, ImageView } from '@image-host/shared/model';
import { SHARE_PATH_PREFIX } from '@image-host/shared/constants';

/**
 * Row → API shape.
 *
 * A presentation layer exists so the column-to-field mapping is written once:
 * `blocked` is an integer in SQLite and a boolean everywhere else, and a route
 * that does `blocked: row.blocked === 1` in six places is six places to get
 * wrong when the column is renamed.
 *
 * `owner_email` and `file_id` are deliberately **not** presented. An owner's own
 * listing does not need to echo the address back, and `file_id` is the Telegram
 * handle — exposing it would let a reader construct a direct Telegram URL and
 * bypass this host's block and delete state entirely.
 */
export function presentImage(row: ImageRow, origin: string): ImageView {
  return {
    id: row.id,
    slug: row.slug,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    blocked: row.blocked === 1,
    viewCount: row.view_count,
    url: `${origin}${SHARE_PATH_PREFIX}/${row.slug}`,
  };
}
