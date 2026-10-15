import { describe, expect, it } from 'vitest';
import { makeSlug, SLUG_CHARACTER_SET } from '@image-host/shared/utils/slug';
import { mimeForFileName, ACCEPTED_MIME_PREFIXES } from '@image-host/shared/utils/mime';
import { MAX_UPLOAD_BYTES, DEFAULT_PAGE_SIZE } from '@image-host/shared/constants';
import { ListImagesQuerySchema, SetBlockedSchema } from '@image-host/shared/schema';

describe('makeSlug', () => {
  it('produces the requested length', () => {
    expect(makeSlug()).toHaveLength(16);
    expect(makeSlug(8)).toHaveLength(8);
  });

  it('only emits characters the share route accepts', () => {
    // The share route rejects anything outside `[A-Za-z0-9]` before it reaches the
    // database. A slug containing anything else would be a link that 404s on
    // generation, so the alphabet is asserted here rather than trusted.
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(makeSlug(32)).toMatch(/^[A-Z0-9]+$/i);
    }
  });

  it('draws from the declared alphabet', () => {
    expect(new Set(makeSlug(256)).size).toBeGreaterThan(20);
    for (const character of makeSlug(256)) {
      expect(SLUG_CHARACTER_SET).toContain(character);
    }
  });

  it('does not repeat', () => {
    // Not a randomness proof — 200 slugs colliding would need a broken
    // `getRandomValues`. It catches the failure where a refactor returns a
    // constant, which is the realistic bug.
    const slugs = new Set(Array.from({ length: 200 }, () => makeSlug()));
    expect(slugs.size).toBe(200);
  });
});

describe('mimeForFileName', () => {
  it('maps known extensions', () => {
    expect(mimeForFileName('a.png')).toBe('image/png');
    expect(mimeForFileName('a.JPG')).toBe('image/jpeg');
    expect(mimeForFileName('archive.tar.mp4')).toBe('video/mp4');
  });

  it('falls back to octet-stream rather than guessing', () => {
    expect(mimeForFileName('mystery')).toBe('application/octet-stream');
    expect(mimeForFileName('a.exe')).toBe('application/octet-stream');
  });

  it('handles a leading dot with no name', () => {
    expect(mimeForFileName('.png')).toBe('image/png');
  });
});

describe('ACCEPTED_MIME_PREFIXES', () => {
  it('accepts the types the host advertises', () => {
    for (const type of ['image/png', 'video/mp4', 'audio/mpeg', 'application/pdf']) {
      expect(ACCEPTED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))).toBe(true);
    }
  });

  it('rejects an archive', () => {
    expect(ACCEPTED_MIME_PREFIXES.some((prefix) => 'application/zip'.startsWith(prefix))).toBe(false);
  });
});

describe('limits', () => {
  it('matches the Telegram download ceiling', () => {
    // If this ever diverges from TELEGRAM_MAX_DOWNLOAD_BYTES the host accepts an
    // upload it can never serve, which is the failure the constant documents.
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });

  it('has a positive page size', () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('ListImagesQuerySchema', () => {
  it('defaults an absent page to 0', () => {
    expect(ListImagesQuerySchema.parse({})).toMatchObject({ page: 0, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('coerces a numeric string rather than rejecting it', () => {
    // `?page=2` arrives as a string. A 400 here would render as a blank console
    // for anyone who hand-edited a URL.
    expect(ListImagesQuerySchema.parse({ page: '2' }).page).toBe(2);
  });

  it('rejects a negative page', () => {
    expect(ListImagesQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
  });

  it('rejects an unbounded pageSize', () => {
    expect(ListImagesQuerySchema.safeParse({ pageSize: '10000' }).success).toBe(false);
  });

  it('treats an empty query as absent', () => {
    // `?q=` must not become a search for the empty string, which would match
    // every row and make the list look broken.
    expect(ListImagesQuerySchema.parse({ q: '' }).q).toBeUndefined();
  });

  it('keeps a real query', () => {
    expect(ListImagesQuerySchema.parse({ q: 'holiday' }).q).toBe('holiday');
  });
});

describe('SetBlockedSchema', () => {
  it('requires a boolean', () => {
    expect(SetBlockedSchema.safeParse({ blocked: true }).success).toBe(true);
    expect(SetBlockedSchema.safeParse({ blocked: 'true' }).success).toBe(false);
    expect(SetBlockedSchema.safeParse({}).success).toBe(false);
  });
});
