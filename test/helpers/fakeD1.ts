import type { D1PreparedStatement, D1Result } from '@rexezuge/d1';

/**
 * A tiny in-memory D1.
 *
 * Not a SQL engine — it pattern-matches the statements the DAOs actually issue.
 * Its job is to let the route and middleware suites run under Node with a real
 * `D1Queryable` shape, so a query that changes shape fails here as loudly as it
 * would in the integration suite.
 *
 * `test/integration/**` remains the authority on anything SQLite-specific (`LIKE`
 * escaping, `LIMIT ? OFFSET ?`, `meta.changes`). This exists to cover the *routing*
 * around the DAOs, which integration tests cannot reach without a `fetch` harness.
 */

export interface FakeRow {
  [column: string]: unknown;
}

type Table = FakeRow[];

export class FakeD1 {
  private readonly tables = new Map<string, Table>();
  private readonly prepared: string[] = [];

  public prepare(query: string): D1PreparedStatement {
    this.prepared.push(query);
    let bindings: unknown[] = [];

    const statement: D1PreparedStatement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      first: async <T>() => {
        const rows = await this.select(query, bindings);
        return (rows[0] as T | undefined) ?? null;
      },
      all: async <T>() => ({ results: this.select(query, bindings) as T[] }),
      run: async () => this.write(query, bindings),
    };
    return statement;
  }

  /**
  Every statement this database was asked to prepare.
  */
  public preparedStatements(): string[] {
    return this.prepared;
  }

  // --- the pieces the DAOs' SQL needs ---------------------------------------

  private select(query: string, bindings: unknown[]): FakeRow[] {
    const normalised = query.replaceAll(/\s+/g, ' ').trim();

    if (normalised.startsWith('SELECT * FROM images WHERE slug = ?')) {
      const [slug, owner] = bindings;
      return this.table('images').filter((row) => row.slug === slug && (owner === undefined || row.owner_email === owner));
    }
    if (normalised.startsWith('SELECT * FROM images WHERE id = ?')) {
      const [id, owner] = bindings;
      return this.table('images').filter((row) => row.id === Number(id) && (owner === undefined || row.owner_email === owner));
    }
    if (normalised.startsWith('SELECT * FROM images WHERE owner_email = ?')) {
      return this.ownerPage(bindings);
    }
    if (normalised.startsWith('SELECT COUNT(*) AS count FROM images')) {
      return [{ count: this.ownerPage(bindings).length }];
    }
    if (normalised.includes('FROM image_views v')) {
      const [imageId, owner, limit] = bindings;
      const ownerRows = this.table('images').filter((row) => row.id === Number(imageId) && row.owner_email === owner);
      if (ownerRows.length === 0) return [];
      return this.table('image_views')
        .filter((row) => row.image_id === Number(imageId))
        .slice(0, Number(limit));
    }
    return [];
  }

  /**
   * One page of `listOwned`.
   *
   * The binding shape differs between callers. The page query sends
   * `[owner, pageSize, offset]` with no search and `[owner, pattern, pageSize,
   * offset]` with one; the count query sends `[owner]` or `[owner, pattern]` and
   * no paging at all. Reading page size from a fixed index therefore reads `0` for
   * an unsearched page and slices it to nothing — a page of zero rows next to a
   * correct-looking `total`, which is exactly the half-working fake this file
   * exists to avoid.
   */
  private ownerPage(bindings: unknown[]): FakeRow[] {
    const [owner, ...rest] = bindings;
    const wantsPattern = typeof rest[0] === 'string';
    const pattern = wantsPattern ? String(rest[0]) : null;
    const pageSize = wantsPattern ? Number(rest[1]) : Number(rest[0] ?? 20);
    const offset = wantsPattern ? Number(rest[2]) : Number(rest[1] ?? 0);

    const live = this.table('images').filter(
      (row) =>
        row.owner_email === owner &&
        row.deleted_at === null &&
        (pattern === null || String(row.file_name).toLowerCase().includes(unlike(pattern))),
    );
    live.sort((left, right) => Number(right.id) - Number(left.id));
    return live.slice(offset, offset + pageSize);
  }

  private async write(query: string, bindings: unknown[]): Promise<D1Result> {
    const normalised = query.replaceAll(/\s+/g, ' ').trim();

    if (normalised.startsWith('INSERT INTO images')) {
      const [slug, ownerEmail, fileId, fileName, mimeType, sizeBytes, messageId, createdAt] = bindings;
      if (this.table('images').some((row) => row.slug === slug)) {
        throw new Error(`D1_ERROR: UNIQUE constraint failed: images.slug: SQLITE_CONSTRAINT`);
      }
      this.table('images').push({
        id: this.nextId('images'),
        slug,
        owner_email: ownerEmail,
        file_id: fileId,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        telegram_message_id: messageId,
        created_at: createdAt,
        deleted_at: null,
        blocked: 0,
        view_count: 0,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalised.startsWith('UPDATE images SET deleted_at')) {
      const [deletedAt, id, owner] = bindings;
      return this.patch(Number(id), owner, { deleted_at: deletedAt });
    }
    if (normalised.startsWith('UPDATE images SET blocked')) {
      const [blocked, id, owner] = bindings;
      return this.patch(Number(id), owner, { blocked });
    }
    if (normalised.startsWith('UPDATE images SET view_count')) {
      const [id] = bindings;
      const row = this.table('images').find((candidate) => candidate.id === Number(id) && candidate.deleted_at === null);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.view_count = Number(row.view_count) + 1;
      return { success: true, meta: { changes: 1 } };
    }
    if (normalised.startsWith('INSERT INTO image_views')) {
      const [imageId, referer, ip, viewedAt] = bindings;
      this.table('image_views').push({ id: this.nextId('image_views'), image_id: imageId, referer, ip, viewed_at: viewedAt });
      return { success: true, meta: { changes: 1 } };
    }
    if (normalised.startsWith('DELETE FROM image_views WHERE id IN')) {
      // The retention prune's batched delete. `viewed_at` is a fixed-format UTC
      // ISO string on every row, so the string comparison here is the same
      // comparison SQLite makes against the bound cutoff — `<` is strict, which
      // is what keeps a row exactly at the cutoff alive.
      const [cutoff, limit] = bindings;
      const table = this.table('image_views');
      const doomed = table.filter((row) => String(row.viewed_at) < String(cutoff)).slice(0, Number(limit));
      const doomedIds = new Set(doomed.map((row) => row.id));
      const kept = table.filter((row) => !doomedIds.has(row.id));
      table.length = 0;
      table.push(...kept);
      return { success: true, meta: { changes: doomed.length } };
    }
    if (normalised.startsWith('DELETE FROM')) {
      // `resetDatabase` empties both tables in dependency order.
      this.table('image_views').length = 0;
      this.table('images').length = 0;
      return { success: true, meta: { changes: 0 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  /**
  Applies the owner-scoped, not-deleted precondition the DAOs rely on.
  */
  private patch(id: number, owner: unknown, changes: FakeRow): D1Result {
    const row = this.table('images').find(
      (candidate) => candidate.id === id && candidate.owner_email === owner && candidate.deleted_at === null,
    );
    if (!row) return { success: true, meta: { changes: 0 } };
    Object.assign(row, changes);
    return { success: true, meta: { changes: 1 } };
  }

  private table(name: string): FakeRow[] {
    const existing = this.tables.get(name);
    if (existing !== undefined) return existing;
    const created: Table = [];
    this.tables.set(name, created);
    return created;
  }

  private nextId(name: string): number {
    const table = this.table(name);
    return table.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1;
  }
}

/**
Reverses `escapeLike`'s escaping so a fake LIKE behaves like SQLite's.
*/
function unlike(pattern: string): string {
  return pattern
    .replace(/^%/, '')
    .replace(/%$/, '')
    .replaceAll(/\\([\\%_])/g, '$1')
    .toLowerCase();
}

/**
A `ServiceEnv` wired to a `FakeD1` and a stubbed Telegram.

`IMAGE_HOST_SECRETS` is shaped as the platform shapes it — an object whose only
member is an async `get()` — rather than as a record of the store's contents.
The old `{ TELEGRAM_BOT_TOKEN: 'test-token' }` double matched no runtime shape at
all: the real binding carries no readable properties, so the route suite passed
against a fixture that could not exist, while production read `undefined` on
every request.
*/
export function fakeEnv(overrides: Record<string, unknown> = {}) {
  const db = new FakeD1();
  const env = {
    ImageHostDB: db as unknown as D1Database,
    IMAGE_HOST_SECRETS: { get: async (): Promise<string> => 'test-token' },
    TELEGRAM_CHAT_ID: '-100999',
    ENVIRONMENT: 'development',
    // The local-only bypass, so the route suites do not need a signed JWT. The
    // integration suite exercises the same var with a real environment check.
    DEV_AUTH_EMAIL: 'tester@example.com',
    ...overrides,
  };
  return { db, env: env as unknown as Env };
}
