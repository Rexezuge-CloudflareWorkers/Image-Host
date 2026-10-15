import { BaseDAO } from '@rexezuge/d1';
import type { ImageRow, NewImage } from '@image-host/shared/model';
import { DEFAULT_PAGE_SIZE } from '@image-host/shared/constants';

/**
 * Every read and write against `images`.
 *
 * Two invariants live here rather than in the routes, because both are the kind
 * of check a route forgets under time pressure:
 *
 * 1. **Ownership is part of the WHERE clause, not a filter applied afterwards.**
 *    `getOwned`, `softDeleteOwned` and `setBlockedOwned` all carry
 *    `owner_email = ?`. A route that fetched by id and compared in JavaScript
 *    would be one refactor away from deleting somebody else's image.
 * 2. **A slug collision raises rather than overwriting.** `insert` retries once
 *    on `UNIQUE`, and a second collision propagates — see `slugCollision`.
 */
export class ImagesDAO extends BaseDAO {
  /**
   * Inserts a row and returns the slug it was written under.
   *
   * Takes a `NewImage` rather than an `Omit<ImageRow, …>` so that the four columns
   * SQLite assigns — `id`, `view_count`, `blocked`, `deleted_at` — are not part of
   * the input. Listing them would invite a caller to pass `deleted_at: null` by
   * hand, which is indistinguishable from a soft-delete at the call site.
   *
   * The slug is **returned** rather than left to the caller to remember, and the
   * row is re-read by that slug rather than by "the newest row for this owner".
   * The latter is wrong the moment one account uploads twice at the same instant:
   * both requests would resolve to whichever row committed last, and one user
   * would receive the other's share link.
   *
   * The caller passes a slug *factory* rather than a slug so a retry gets a
   * different one. A 62-character alphabet at 16 characters makes a collision
   * improbable, which is exactly why it must not be silently ignored when it does
   * happen: the alternative is a 500 from a constraint violation that reads like
   * a database failure.
   */
  public async insert(row: NewImage, nextSlug: () => string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const slug = row.slug || nextSlug();
      try {
        await this.run(
          `INSERT INTO images
             (slug, owner_email, file_id, file_name, mime_type, size_bytes, telegram_message_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [slug, row.owner_email, row.file_id, row.file_name, row.mime_type, row.size_bytes, row.telegram_message_id, row.created_at],
        );
        return slug;
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error, 'images.slug')) continue;
        throw error;
      }
    }
    /* c8 ignore next -- the loop above either returns or throws on attempt 2 */
    throw new Error('unreachable: insert exhausted its attempts without returning or throwing');
  }

  /**
  By share-link slug, for the anonymous `GET /i/:slug` read.
  */
  public async getBySlug(slug: string): Promise<ImageRow | null> {
    return this.first<ImageRow>(`SELECT * FROM images WHERE slug = ?`, [slug]);
  }

  /**
  By id, scoped to its owner.
  */
  public async getOwned(id: number, ownerEmail: string): Promise<ImageRow | null> {
    return this.first<ImageRow>(`SELECT * FROM images WHERE id = ? AND owner_email = ?`, [id, ownerEmail]);
  }

  /**
   * By slug, scoped to its owner.
   *
   * Both predicates because this backs the post-upload read-back: a slug is
   * globally unique, but the read exists to confirm *this owner's* write landed,
   * and a slug-only read would happily return another account's row.
   */
  public async getOwnedBySlug(slug: string, ownerEmail: string): Promise<ImageRow | null> {
    return this.first<ImageRow>(`SELECT * FROM images WHERE slug = ? AND owner_email = ?`, [slug, ownerEmail]);
  }

  /**
   * One page of an owner's images, newest first.
   *
   * `deleted_at IS NULL` is in both the page query and the count, so `total` is
   * the number of rows a caller can actually page through. Counting soft-deleted
   * rows would leave the SPA showing fewer images than it claims exist, forever.
   */
  public async listOwned(
    ownerEmail: string,
    page: number,
    pageSize: number = DEFAULT_PAGE_SIZE,
    query?: string,
  ): Promise<{ rows: ImageRow[]; total: number }> {
    const offset = page * pageSize;
    const filter = query ? String.raw`AND file_name LIKE ? ESCAPE '\'` : '';
    const bindings = query ? [ownerEmail, `%${escapeLike(query)}%`] : [ownerEmail];
    const rows = await this.all<ImageRow>(
      `SELECT * FROM images
        WHERE owner_email = ? AND deleted_at IS NULL ${filter}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...bindings, pageSize, offset],
    );
    // `AS count` is load-bearing: `BaseDAO.count()` reads the column named `count`, and a
    // bare `SELECT COUNT(*)` yields one named `COUNT(*)`, so the lookup returns
    // undefined and every list reports `total: 0` alongside correct rows.
    const total = await this.count(`SELECT COUNT(*) AS count FROM images WHERE owner_email = ? AND deleted_at IS NULL ${filter}`, bindings);
    return { rows, total };
  }

  /**
   * Soft-deletes an image the caller owns.
   *
   * Soft rather than hard on purpose: the Telegram message is deleted separately
   * and a hard row delete would leave an orphan in the group with no record that
   * it was ever ours. The row is what keeps the share link answering 404 rather
   * than serving an image nobody has claimed to have deleted.
   *
   * Returns `false` when no live row matched, which is the caller's 404 — and
   * which is also the answer for a row owned by somebody else, so this cannot be
   * used to probe for the existence of another user's image.
   */
  public async softDeleteOwned(id: number, ownerEmail: string): Promise<boolean> {
    const result = await this.run(`UPDATE images SET deleted_at = ? WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`, [
      new Date().toISOString(),
      id,
      ownerEmail,
    ]);
    return (result.meta?.changes ?? 0) > 0;
  }

  /**
  Blocks or unblocks an image the caller owns. A deleted image cannot be unblocked.
  */
  public async setBlockedOwned(id: number, ownerEmail: string, blocked: boolean): Promise<boolean> {
    const result = await this.run(`UPDATE images SET blocked = ? WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`, [
      blocked ? 1 : 0,
      id,
      ownerEmail,
    ]);
    return (result.meta?.changes ?? 0) > 0;
  }
}

/**
 * Escapes the `LIKE` wildcards so a search for `100%` is a literal search.
 *
 * `ESCAPE '\'` is stated in the query and the backslash escaped here. Without
 * both, a query of `%` matches every row and `a_b` matches `axb` — the second is
 * the worse of the two, because a user searching for a filename with an
 * underscore silently gets a superset.
 */
export function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Whether an error is a unique-constraint violation on one named column.
 *
 * D1 surfaces the constraint in the message rather than exposing an error code,
 * so this matches text. The column is required so a *different* unique violation
 * — `file_id` colliding because Telegram reissued an id, say — does not get
 * retried as though it were a slug collision.
 */
function isUniqueViolation(error: unknown, column: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: .*\./.test(message) && message.includes(column);
}
