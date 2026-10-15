/**
A row of the `images` table, as D1 returns it: snake_case columns, `blocked` as an integer.
*/
export interface ImageRow {
  id: number;
  slug: string;
  owner_email: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  telegram_message_id: number | null;
  created_at: string;
  deleted_at: string | null;
  blocked: number;
  view_count: number;
}

/**
 * The columns a caller supplies on insert.
 *
 * Narrower than `ImageRow` on purpose: `id`, `view_count`, `blocked` and
 * `deleted_at` are assigned by SQLite, and listing them as required input would
 * invite a caller to pass `blocked: 0` and `deleted_at: null` by hand — which is
 * the same shape as a soft-delete, and impossible to tell apart at the call site.
 */
export interface NewImage {
  slug: string;
  owner_email: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  telegram_message_id: number | null;
  created_at: string;
}

/**
An image as the API presents it: camelCase, and `blocked` as a boolean.
*/
export interface ImageView {
  id: number;
  slug: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  blocked: boolean;
  viewCount: number;
  /**
  Absolute share link. Present on every presentation so the SPA never builds one.
  */
  url: string;
}

/**
The response of `GET /user/me`. The SPA treats a 200 here as "authenticated".
*/
export interface CurrentUser {
  email: string;
}

export interface UploadedImage {
  fileId: string;
  fileName: string;
  /**
  Captured from the Telegram response so a later delete can remove the message.
  */
  messageId: number | null;
}

export interface PagedImages {
  data: ImageView[];
  page: number;
  pageSize: number;
  total: number;
}
