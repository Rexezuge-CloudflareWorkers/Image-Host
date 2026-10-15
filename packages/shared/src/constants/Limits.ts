/**
 * Content limits.
 *
 * `MAX_UPLOAD_BYTES` mirrors the Telegram Bot API's own ceiling: `getFile`
 * refuses to hand back a download URL for anything larger, so accepting more at
 * the edge would produce an upload that succeeds and can never be served again.
 * Keep the two in step — a raise here is a raise there.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const DEFAULT_PAGE_SIZE = 20;

/**
Telegram's `getFile` download ceiling, named separately so the reason survives a search.
*/
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
