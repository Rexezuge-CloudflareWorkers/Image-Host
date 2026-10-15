import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import { useDatabase, resetDatabase } from './helpers/migrations';

/**
 * The DAOs against a real D1.
 *
 * The node suite stubs the database, which is exactly why the properties asserted
 * here cannot be checked there: `LIKE` escaping, `LIMIT ? OFFSET ?` binding, the
 * `meta.changes` that ownership-scoped writes report, and the unique constraint
 * `insert` retries on are all behaviours of SQLite rather than of the query text.
 */

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

type NewRow = Parameters<ImagesDAO['insert']>[0];

function row(overrides: Partial<NewRow> = {}): NewRow {
  return {
    slug: '',
    owner_email: OWNER,
    file_id: 'file-1',
    file_name: 'holiday.png',
    mime_type: 'image/png',
    size_bytes: 1024,
    telegram_message_id: 111,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
A deterministic slug factory, so a test can force a collision.
*/
/**
 * A monotonic counter, not `Math.random()`.
 *
 * The counter is guaranteed unique within a file, which is what the slug needs to be;
 * `Math.random()` merely makes a collision unlikely, and a collision here would
 * surface as a confusing UNIQUE-violation failure rather than a clear one.
 */
let slugCounter = 0;
function nextSlug(): string {
  slugCounter += 1;
  return `gen${String(slugCounter).padStart(14, '0')}`;
}

/**
A deterministic slug factory, so a test can force a collision.
*/
function slugger(values: string[]): () => string {
  let index = 0;
  return () => {
    const next = values[index];
    index += 1;
    if (next === undefined) throw new Error('slug factory exhausted');
    return next;
  };
}

describe('ImagesDAO', () => {
  let db: D1Database;
  let images: ImagesDAO;

  /**
   * Inserts and returns the row, by slug.
   *
   * Never by a hardcoded id: `resetDatabase` issues `DELETE`, which does not reset
   * SQLite's `AUTOINCREMENT` counter, so ids climb monotonically across tests in a
   * file. Reading the id back is also what the production code does.
   */
  async function insert(overrides: Partial<NewRow> = {}, slug = nextSlug()) {
    const used = await images.insert(row(overrides), () => slug);
    const inserted = await images.getBySlug(used);
    if (!inserted) throw new Error(`inserted row ${used} vanished`);
    return inserted;
  }

  beforeEach(async () => {
    db = await useDatabase();
    await resetDatabase(db);
    images = new ImagesDAO(db);
  });

  describe('insert', () => {
    it('writes a row and returns the slug it used', async () => {
      const inserted = await insert({}, 'AbCdEfGh12345678');
      expect(inserted.slug).toBe('AbCdEfGh12345678');
      expect(inserted.owner_email).toBe(OWNER);
      // Defaults the caller never supplies.
      expect(inserted.blocked).toBe(0);
      expect(inserted.view_count).toBe(0);
      expect(inserted.deleted_at).toBeNull();
    });

    it('retries onto a fresh slug when the first collides', async () => {
      await insert({}, 'collideMe0000001');
      const used = await images.insert(row({ file_id: 'file-2' }), slugger(['collideMe0000001', 'different000002']));
      expect(used).toBe('different000002');
      await expect(images.getBySlug('different000002')).resolves.not.toBeNull();
    });

    it('propagates a second collision rather than looping forever', async () => {
      // The retry is bounded at one attempt. Past that the caller must see the
      // constraint violation — an unbounded loop would hang a request on a slug
      // factory that keeps returning the same value.
      await insert({}, 'alwaysTheSame001');
      await expect(images.insert(row({ file_id: 'file-9' }), () => 'alwaysTheSame001')).rejects.toThrow(/UNIQUE/i);
    });

    it('does not mask a non-slug violation as a slug collision', async () => {
      // `file_id` is deliberately not UNIQUE: Telegram reissuing an id must not
      // break an unrelated upload. So two rows may share one.
      await insert({}, 'sharesFileId00001');
      const second = await insert({ file_id: 'file-1' }, 'sharesFileId00002');
      expect(second.file_id).toBe('file-1');
    });
  });

  describe('ownership scoping', () => {
    let mine: { id: number; slug: string };

    beforeEach(async () => {
      mine = await insert({}, 'ownedByFirst00001');
    });

    it('getOwned refuses another account', async () => {
      await expect(images.getOwned(mine.id, OWNER)).resolves.not.toBeNull();
      await expect(images.getOwned(mine.id, OTHER)).resolves.toBeNull();
    });

    it('getOwnedBySlug refuses another account', async () => {
      await expect(images.getOwnedBySlug(mine.slug, OWNER)).resolves.not.toBeNull();
      await expect(images.getOwnedBySlug(mine.slug, OTHER)).resolves.toBeNull();
    });

    it('softDeleteOwned reports false for another account, and changes nothing', async () => {
      // One answer for "does not exist" and "is not yours" — distinguishing them
      // would make this an oracle for probing other users' image ids.
      await expect(images.softDeleteOwned(mine.id, OTHER)).resolves.toBe(false);
      await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ deleted_at: null });
    });

    it('setBlockedOwned reports false for another account, and changes nothing', async () => {
      await expect(images.setBlockedOwned(mine.id, OTHER, true)).resolves.toBe(false);
      await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ blocked: 0 });
    });

    it('the owner can soft-delete', async () => {
      await expect(images.softDeleteOwned(mine.id, OWNER)).resolves.toBe(true);
      await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ deleted_at: expect.any(String) });
    });

    it('a second delete is a no-op', async () => {
      await images.softDeleteOwned(mine.id, OWNER);
      await expect(images.softDeleteOwned(mine.id, OWNER)).resolves.toBe(false);
    });
  });

  describe('listOwned', () => {
    beforeEach(async () => {
      await insert({ file_name: 'alpha.png' }, 'slugAlpha00000001');
      await insert({ file_name: 'beta.png', file_id: 'file-2' }, 'slugBeta000000002');
      await insert({ file_name: 'gamma.png', file_id: 'file-3' }, 'slugGamma00000003');
    });

    it('returns only the caller rows, newest first', async () => {
      const { rows, total } = await images.listOwned(OWNER, 0);
      expect(total).toBe(3);
      expect(rows.map((r) => r.file_name)).toEqual(['gamma.png', 'beta.png', 'alpha.png']);
    });

    it('excludes another owner entirely', async () => {
      await expect(images.listOwned(OTHER, 0)).resolves.toMatchObject({ total: 0, rows: [] });
    });

    it('excludes soft-deleted rows from both the page and the count', async () => {
      // Counting them would leave the SPA promising more images than it shows.
      const victim = await images.getBySlug('slugAlpha00000001');
      await images.softDeleteOwned(victim!.id, OWNER);
      const { rows, total } = await images.listOwned(OWNER, 0);
      expect(total).toBe(2);
      expect(rows).toHaveLength(2);
    });

    it('pages, and reports the unpaged total', async () => {
      const first = await images.listOwned(OWNER, 0, 2);
      const second = await images.listOwned(OWNER, 1, 2);
      expect(first.rows).toHaveLength(2);
      expect(second.rows).toHaveLength(1);
      expect(first.total).toBe(3);
    });

    it('treats a wildcard in the query as a literal', async () => {
      // `%` unescaped matches every row, so a user searching for `100%` would get
      // the whole library back.
      await expect(images.listOwned(OWNER, 0, 20, '%')).resolves.toMatchObject({ total: 0 });
    });

    it('matches an underscore-containing name literally', async () => {
      await insert({ file_name: 'a_b.png', file_id: 'file-4' }, 'slugUnderscore0004');
      await insert({ file_name: 'axb.png', file_id: 'file-5' }, 'slugPlain00000005');
      const { rows } = await images.listOwned(OWNER, 0, 20, 'a_b');
      expect(rows.map((r) => r.file_name)).toEqual(['a_b.png']);
    });
  });

  describe('setBlockedOwned', () => {
    it('toggles, and refuses a deleted row', async () => {
      const mine = await insert({}, 'blockedByThen00001');

      await expect(images.setBlockedOwned(mine.id, OWNER, true)).resolves.toBe(true);
      await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ blocked: 1 });

      await images.softDeleteOwned(mine.id, OWNER);
      // A deleted image cannot be unblocked: the link answers 404 either way, and
      // allowing the flip would suggest the state is recoverable.
      await expect(images.setBlockedOwned(mine.id, OWNER, false)).resolves.toBe(false);
    });
  });
});

describe('ImageViewsDAO', () => {
  let db: D1Database;
  let images: ImagesDAO;
  let views: ImageViewsDAO;

  async function insert(overrides: Partial<NewRow> = {}) {
    const slug = nextSlug();
    await images.insert(row(overrides), () => slug);
    const inserted = await images.getBySlug(slug);
    if (!inserted) throw new Error(`inserted row ${slug} vanished`);
    return inserted;
  }

  beforeEach(async () => {
    db = await useDatabase();
    await resetDatabase(db);
    images = new ImagesDAO(db);
    views = new ImageViewsDAO(db);
  });

  it('bumps the counter and records the view', async () => {
    const mine = await insert();
    await views.recordAndCount(mine.id, 'https://referrer.example', '203.0.113.7');

    await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ view_count: 1 });
    const logged = await views.listForImage(mine.id, OWNER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.referer).toBe('https://referrer.example');
    expect(logged[0]?.ip).toBe('203.0.113.7');
  });

  it('does not count a view on a soft-deleted image', async () => {
    // A link that 404s must not keep reporting traffic.
    const mine = await insert();
    await images.softDeleteOwned(mine.id, OWNER);
    await views.recordAndCount(mine.id, 'direct', '198.51.100.1');

    await expect(images.getOwned(mine.id, OWNER)).resolves.toMatchObject({ view_count: 0 });
  });

  it('does not leak one owner view log to another', async () => {
    // The referer and IP are personal data.
    const mine = await insert();
    await views.recordAndCount(mine.id, 'https://referrer.example', '203.0.113.7');
    await expect(views.listForImage(mine.id, OTHER)).resolves.toHaveLength(0);
  });
});

describe('schema', () => {
  it('exposes exactly the tables the DAOs need', async () => {
    const db = await useDatabase();
    const { results } = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
      .all<{ name: string }>();
    const names = results.map((r) => r.name).toSorted();
    expect(names).toEqual(['d1_migrations', 'image_views', 'images']);
  });

  it('enforces slug uniqueness in the database, not only in the DAO', async () => {
    // The uniqueness `insert`'s retry depends on must be the database's; a DAO-only
    // check would be defeated by two concurrent inserts.
    const db = await useDatabase();
    await resetDatabase(db);
    const dao = new ImagesDAO(db);
    await dao.insert(row(), () => 'duplicateSlug001');
    await expect(dao.insert(row({ file_id: 'other' }), () => 'duplicateSlug001')).rejects.toThrow(/UNIQUE/i);
  });

  it('resolves the D1 binding declared in the test wrangler config', () => {
    expect(env.ImageHostDB).toBeDefined();
  });
});
