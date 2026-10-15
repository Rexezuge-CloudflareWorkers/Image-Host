import { BadRequestError, NotFoundError, PayloadTooLargeError, UnsupportedMediaTypeError } from '@rexezuge/errors';
import type { ImageRow, ImageView, PagedImages } from '@image-host/shared/model';
import { makeSlug, mimeForFileName, ACCEPTED_MIME_PREFIXES } from '@image-host/shared/utils';
import { MAX_UPLOAD_BYTES, DEFAULT_PAGE_SIZE } from '@image-host/shared/constants';
import type { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import { presentImage } from '@image-host/backend-data/presenters';
import type { TelegramClient } from '@image-host/provider-clients/telegram';
import { ConfigurationManager } from '../config';
import type { ServiceEnv } from '../composition/ServiceEnv';

export interface UploadResult {
  image: ImageView;
}

/**
 * The image domain: validate, store, and account for ownership.
 *
 * Every method that changes state takes the owner's address as its first
 * argument and passes it straight into an owner-scoped DAO query. There is no
 * "load then check" path anywhere in this class — that shape is what produces a
 * `getById` followed by a comparison that a later refactor drops.
 */
export class ImageService {
  constructor(
    private readonly env: ServiceEnv,
    private readonly images: ImagesDAO,
    private readonly telegram: TelegramClient,
    private readonly views: ImageViewsDAO,
  ) {}

  /**
  Validates and stores one upload, returning the presented image.
  */
  public async upload(ownerEmail: string, origin: string, file: File): Promise<UploadResult> {
    const fileName = sanitiseFileName(file.name);
    const declaredType = file.type || mimeForFileName(fileName);

    if (ACCEPTED_MIME_PREFIXES.every((prefix) => !declaredType.startsWith(prefix))) {
      // The client-declared type is what picks the Telegram endpoint, and a
      // caller can put anything in it. Rejecting the obviously-wrong cases keeps
      // an arbitrary archive out of the group; it is a shape check, not
      // validation of the bytes.
      throw new UnsupportedMediaTypeError(`Unsupported content type: ${declaredType}`);
    }

    const maxBytes = ConfigurationManager.limits.getMaxUploadBytes(this.env, MAX_UPLOAD_BYTES);
    if (file.size > maxBytes) {
      throw new PayloadTooLargeError(`File exceeds the ${maxBytes}-byte limit.`);
    }
    if (file.size === 0) {
      throw new BadRequestError('Uploaded file is empty.');
    }

    // Telegram first, then the row. The reverse order would leave a row whose
    // `file_id` resolves to nothing if the upload failed, which is a share link
    // that 500s instead of one that 404s.
    const stored = await this.telegram.upload(file, fileName);

    const slug = await this.images.insert(
      {
        slug: '',
        owner_email: ownerEmail,
        file_id: stored.fileId,
        file_name: stored.fileName,
        mime_type: declaredType,
        size_bytes: file.size,
        telegram_message_id: stored.messageId,
        created_at: new Date().toISOString(),
      },
      () => makeSlug(),
    );

    // Read back by the slug `insert` reports, never by "the newest row for this
    // owner" — under two concurrent uploads the latter hands one user the
    // other's share link.
    const row = await this.images.getOwnedBySlug(slug, ownerEmail);
    if (!row) {
      throw new NotFoundError('Image was stored but could not be read back.');
    }
    return { image: presentImage(row, origin) };
  }

  public async listOwned(
    ownerEmail: string,
    origin: string,
    page: number,
    pageSize = DEFAULT_PAGE_SIZE,
    query?: string,
  ): Promise<PagedImages> {
    const { rows, total } = await this.images.listOwned(ownerEmail, page, pageSize, query);
    return {
      data: rows.map((row) => presentImage(row, origin)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Soft-deletes an image and removes the underlying message.
   *
   * The row goes first and the Telegram call second, so the share link stops
   * answering the instant the user asks it to. `deleteMessage` is best-effort
   * inside the client: if Telegram is down the bytes stay in the group, but the
   * user's delete has still succeeded, which is the outcome they asked for.
   */
  public async softDelete(ownerEmail: string, id: number): Promise<void> {
    const row = await this.images.getOwned(id, ownerEmail);
    if (!row || row.deleted_at) {
      // One 404 for "does not exist", "is not yours" and "is already deleted".
      // Distinguishing them would turn this into an oracle for probing other
      // users' image ids.
      throw new NotFoundError('Image not found.');
    }
    const deleted = await this.images.softDeleteOwned(id, ownerEmail);
    if (!deleted) {
      throw new NotFoundError('Image not found.');
    }
    if (row.telegram_message_id !== null) {
      await this.telegram.deleteMessage(row.telegram_message_id);
    }
  }

  /**
  Blocks or unblocks an image the caller owns.
  */
  public async setBlocked(ownerEmail: string, id: number, blocked: boolean): Promise<void> {
    const updated = await this.images.setBlockedOwned(id, ownerEmail, blocked);
    if (!updated) {
      throw new NotFoundError('Image not found.');
    }
  }

  /**
   * Resolves a share-link slug to a servable row.
   *
   * The blocked/deleted check is here rather than in the route so that every
   * caller of the share path agrees on what "not available" means — and so the
   * public read has exactly one place that can forget the check.
   */
  public async resolveShare(slug: string): Promise<ImageRow> {
    const row = await this.images.getBySlug(slug);
    if (!row || row.deleted_at) {
      throw new NotFoundError('Image not found.');
    }
    if (row.blocked === 1) {
      throw new NotFoundError('Image not found.');
    }
    return row;
  }

  /**
   * Streams a row's bytes from Telegram.
   *
   * Exposed on the service rather than letting the route reach the provider client
   * directly, because the lint boundary that forbids `apps/api` from importing
   * `provider-clients` is only worth anything if there is a supported way *in*.
   * The upstream `Response` is returned with its body untouched — buffering it
   * here would turn a 20 MB image into an isolate heap spike.
   */
  public download(row: ImageRow): Promise<Response> {
    return this.telegram.download(row.file_id);
  }

  /**
  Records an anonymous view: bumps the counter and appends to the log.
  */
  public recordView(imageId: number, referer: string, ip: string): Promise<void> {
    return this.views.recordAndCount(imageId, referer, ip);
  }
}

/**
 * Strips any path component from a client-supplied filename.
 *
 * The name is stored and presented back, so a `../../etc/passwd` would render as
 * a link in the owner's own listing and, worse, as a download filename. The
 * basename is taken first and the result is bounded, so a 4 KB name cannot be
 * stored as a 4 KB column value.
 */
export function sanitiseFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // Control characters are filtered by code point rather than a regex range: the
  // range \x00-\x1f is opaque at the call site and trips two lint rules, while
  // codePointAt says exactly what it removes.
  let stripped = '';
  for (const character of base) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) stripped += character;
  }
  const cleaned = stripped.trim();
  const bounded = cleaned.slice(0, 200);
  return bounded.length > 0 ? bounded : 'upload';
}
