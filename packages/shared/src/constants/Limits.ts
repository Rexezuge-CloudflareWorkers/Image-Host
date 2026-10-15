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
 * How long `image_views` rows are kept before the daily prune removes them.
 *
 * The log is telemetry for the owner's own traffic and nothing user-facing reads
 * it, so it is a **rolling window**, not history: `images.view_count` is the
 * lifetime figure and is never decremented by the prune.
 */
export const VIEW_LOG_RETENTION_DAYS = 30;

/**
 * Rows deleted per statement in the view-log prune.
 *
 * One D1 statement deletes one batch, and each statement is a subrequest against
 * the invocation's ceiling, so this is a work-per-statement knob — not a
 * semantic one. The retention service loops until a batch comes back short.
 */
export const VIEW_LOG_PRUNE_BATCH_SIZE = 500;

/**
 * Batches one scheduled run may delete.
 *
 * The daily invocation has finite subrequest and wall-clock budgets, so a large
 * backlog drains over several days rather than risking a run that is killed
 * midway with nothing to show for it. A capped run is logged as capped, so the
 * remaining backlog is visible rather than inferred.
 */
export const VIEW_LOG_PRUNE_MAX_BATCHES = 20;

/**
Telegram's `getFile` download ceiling, named separately so the reason survives a search.
*/
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
