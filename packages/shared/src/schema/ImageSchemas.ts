import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_UPLOAD_BYTES } from '../constants';

/**
 * Query parameters for `GET /user/images`.
 *
 * `page` is coerced rather than validated: a `?page=abc` arriving from a
 * hand-edited URL should render page 0, not a 400 the SPA cannot render.
 */
export const ListImagesQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  /**
   * The search term.
   *
   * `?q=` is treated as *absent* rather than rejected or passed through. An empty
   * string that reached the DAO would become `%` and match every row, so the list
   * would silently widen; and a 400 would blank the console for the common case of
   * a search box that was cleared and submitted. The `.max` is a bound on what is
   * stored in a prepared statement, not a UX limit.
   */
  q: z
    .string()
    .max(200)
    .transform((value) => value.trim())
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional(),
});

export type ListImagesQuery = z.infer<typeof ListImagesQuerySchema>;

/**
Body of `PUT /user/images/:id/block`.
*/
export const SetBlockedSchema = z.object({
  blocked: z.boolean(),
});

export type SetBlockedBody = z.infer<typeof SetBlockedSchema>;

/**
 * The upload form.
 *
 * `MAX_UPLOAD_BYTES` is asserted here as well as in the handler: the handler's
 * check is the one that produces a 413, and this constant is what keeps the two
 * from drifting into a limit the schema accepts and the handler rejects.
 */
export const UploadConstraints = {
  maxBytes: MAX_UPLOAD_BYTES,
  /**
  The multipart field name. The client sends `file`.
  */
  fieldName: 'file',
} as const;
