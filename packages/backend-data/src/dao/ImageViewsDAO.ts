import { BaseDAO } from '@rexezuge/d1';

export interface ImageViewRow {
  id: number;
  referer: string | null;
  ip: string | null;
  viewed_at: string;
}

/**
 * Anonymous view telemetry for `GET /i/:slug`.
 *
 * Every method here is best-effort by construction: it runs inside `waitUntil`
 * on a **public** route, so a failure must never surface to the viewer or delay
 * the bytes. The route swallows the rejection, which is why this DAO does not
 * need to be defensive itself.
 */
export class ImageViewsDAO extends BaseDAO {
  public async record(imageId: number, referer: string, ip: string): Promise<void> {
    await this.run(`INSERT INTO image_views (image_id, referer, ip, viewed_at) VALUES (?, ?, ?, ?)`, [
      imageId,
      referer,
      ip,
      new Date().toISOString(),
    ]);
  }

  /**
   * Increments `view_count` in the same statement that records the view, so the
   * counter cannot drift from the log if one of the two fails.
   *
   * `WHERE deleted_at IS NULL` keeps a soft-deleted image's counter frozen: a
   * share link that 404s must not keep reporting traffic.
   */
  public async recordAndCount(imageId: number, referer: string, ip: string): Promise<void> {
    await this.run(`UPDATE images SET view_count = view_count + 1 WHERE id = ? AND deleted_at IS NULL`, [imageId]);
    await this.run(`INSERT INTO image_views (image_id, referer, ip, viewed_at) VALUES (?, ?, ?, ?)`, [
      imageId,
      referer,
      ip,
      new Date().toISOString(),
    ]);
  }

  /**
  An owner's own view log. Never public — the referer and IP are personal data.
  */
  public async listForImage(imageId: number, ownerEmail: string, limit = 50): Promise<ImageViewRow[]> {
    return this.all<ImageViewRow>(
      `SELECT v.id, v.referer, v.ip, v.viewed_at
         FROM image_views v
         JOIN images i ON i.id = v.image_id
        WHERE v.image_id = ? AND i.owner_email = ?
        ORDER BY v.id DESC
        LIMIT ?`,
      [imageId, ownerEmail, limit],
    );
  }
}
