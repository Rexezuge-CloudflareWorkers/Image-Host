import { describe, expect, it } from 'vitest';
import { ImagesDAO } from '@image-host/backend-data/dao';
import { Container, Tokens } from '@image-host/backend-services/composition';
import { VIEW_LOG_PRUNE_BATCH_SIZE, VIEW_LOG_PRUNE_MAX_BATCHES } from '@image-host/shared/constants';
import { fakeEnv, type FakeD1 } from '../helpers/fakeD1';

/**
 * The view-log retention loop.
 *
 * The node fake cannot prove anything SQLite-specific — that is the integration
 * suite's job — but it can prove the *loop*: which rows a run deletes, when it
 * stops early, and when it stops at the ceiling instead. Those are policy, and
 * the failure mode they guard against is the one that has no symptom: a prune
 * that reports success while the table keeps growing.
 *
 * Rows are backdated by hand because `record()` always stamps "now" — the one
 * timestamp a retention test cannot use.
 */

const OWNER = 'owner@example.com';

/**
 * A fixed clock, so the cutoff is a value rather than a race.
 */
const NOW = new Date('2026-06-15T12:00:00.000Z');

const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

/**
 * Inserts one live image and returns its id.
 *
 * The bindings are positional in the order the fake reads them, which is the
 * DAO's own insert order — a fake is only as honest as its binding contract.
 */
async function seedImage(db: FakeD1): Promise<number> {
  const slug = 'seed000000000001';
  await db
    .prepare(
      'INSERT INTO images (slug, owner_email, file_id, file_name, mime_type, size_bytes, telegram_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(slug, OWNER, 'file-1', 'holiday.png', 'image/png', 1024, 111, daysAgo(0))
    .run();
  const row = await new ImagesDAO(db as unknown as D1Database).getOwnedBySlug(slug, OWNER);
  if (!row) throw new Error('seed image not found');
  return row.id;
}

async function seedView(db: FakeD1, imageId: number, viewedAt: string): Promise<void> {
  await db
    .prepare('INSERT INTO image_views (image_id, referer, ip, viewed_at) VALUES (?, ?, ?, ?)')
    .bind(imageId, 'direct', '203.0.113.1', viewedAt)
    .run();
}

describe('ViewLogRetentionService', () => {
  it('deletes rows past the window, keeps the boundary row, and leaves the rest for the read path', async () => {
    const { db, env } = fakeEnv();
    const imageId = await seedImage(db);
    await seedView(db, imageId, daysAgo(45));
    await seedView(db, imageId, daysAgo(31));
    // Exactly at the cutoff (30-day default): the comparison is strict, so this
    // row survives — the boundary is asserted here as well as in integration.
    await seedView(db, imageId, daysAgo(30));
    await seedView(db, imageId, daysAgo(1));

    const scope = new Container(env);
    const retention = await scope.get(Tokens.ViewLogRetentionService);

    await expect(retention.prune(NOW)).resolves.toEqual({ deleted: 2, batches: 1, capped: false });

    // Read back through the owner-scoped read path: "deleted 2" is the service's
    // claim, and the surviving rows are the evidence.
    const views = await scope.get(Tokens.ImageViewsDAO);
    await expect(views.listForImage(imageId, OWNER)).resolves.toHaveLength(2);
  });

  it('drains a backlog over several batches until one comes back short', async () => {
    const { db, env } = fakeEnv();
    const imageId = await seedImage(db);
    const backlog = VIEW_LOG_PRUNE_BATCH_SIZE + 1;
    for (let index = 0; index < backlog; index += 1) {
      await seedView(db, imageId, daysAgo(60));
    }

    const retention = await new Container(env).get(Tokens.ViewLogRetentionService);
    const result = await retention.prune(NOW);

    // A full batch is "there may be more"; only a short one is "done".
    expect(result).toEqual({ deleted: backlog, batches: 2, capped: false });
  });

  it('stops at the ceiling and reports the remainder instead of running past the invocation budget', async () => {
    const { db, env } = fakeEnv();
    const imageId = await seedImage(db);
    const backlog = VIEW_LOG_PRUNE_MAX_BATCHES * VIEW_LOG_PRUNE_BATCH_SIZE + 1;
    for (let index = 0; index < backlog; index += 1) {
      await seedView(db, imageId, daysAgo(60));
    }

    const scope = new Container(env);
    const retention = await scope.get(Tokens.ViewLogRetentionService);

    const first = await retention.prune(NOW);
    expect(first).toEqual({ deleted: backlog - 1, batches: VIEW_LOG_PRUNE_MAX_BATCHES, capped: true });

    // The remainder drains on the next run — the cap defers work, it never drops it.
    const second = await retention.prune(NOW);
    expect(second).toEqual({ deleted: 1, batches: 1, capped: false });
  });

  it('reads the window from VIEW_LOG_RETENTION_DAYS', async () => {
    const { db, env } = fakeEnv({ VIEW_LOG_RETENTION_DAYS: '1' });
    const imageId = await seedImage(db);
    await seedView(db, imageId, daysAgo(2));
    await seedView(db, imageId, daysAgo(0.5));

    const retention = await new Container(env).get(Tokens.ViewLogRetentionService);

    // Under the shared 30-day default both rows would survive; under a one-day
    // window only the older one goes, so this asserts the config path itself.
    await expect(retention.prune(NOW)).resolves.toEqual({ deleted: 1, batches: 1, capped: false });
  });
});
