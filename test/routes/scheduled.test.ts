import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import { VIEW_LOG_PRUNE_BATCH_SIZE, VIEW_LOG_PRUNE_MAX_BATCHES } from '@image-host/shared/constants';
import worker from '@image-host/api';
import { fakeEnv, type FakeD1 } from '../helpers/fakeD1';

/**
 * The cron entrypoint.
 *
 * The prune itself is covered where it lives (`ViewLogRetentionService`,
 * `ImageViewsDAO`); what this file exists for is the *wiring*: the handler must
 * resolve the service through the composition root — the same way a route does —
 * and must let a failure escape rather than swallow it, because a swallowed
 * error on a cron path leaves only the absence of a log line to infer from.
 *
 * Calls go through `ImageHostWorker`'s default export — the object the runtime
 * actually invokes — rather than `handleScheduled` directly, so the `scheduled`
 * wrapper cannot be left untested while its callee is covered.
 */

const OWNER = 'owner@example.com';

/**
 * Two days around the default 30-day window, measured against the real clock
 * because the handler does not take one.
 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedImage(db: FakeD1): Promise<number> {
  const slug = 'seed000000000001';
  const images = new ImagesDAO(db as unknown as D1Database);
  await images.insert(
    {
      slug: '',
      owner_email: OWNER,
      file_id: 'file-1',
      file_name: 'holiday.png',
      mime_type: 'image/png',
      size_bytes: 1024,
      telegram_message_id: 111,
      created_at: daysAgo(0),
    },
    () => slug,
  );
  const row = await images.getOwnedBySlug(slug, OWNER);
  if (!row) throw new Error('seed image not found');
  return row.id;
}

async function seedView(db: FakeD1, imageId: number, viewedAt: string): Promise<void> {
  await db
    .prepare('INSERT INTO image_views (image_id, referer, ip, viewed_at) VALUES (?, ?, ?, ?)')
    .bind(imageId, 'direct', '203.0.113.1', viewedAt)
    .run();
}

function scheduledEvent(): ScheduledController {
  return { cron: '17 3 * * *', scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the scheduled entrypoint', () => {
  it('resolves the retention service, prunes, and logs the run', async () => {
    const { db, env } = fakeEnv();
    const imageId = await seedImage(db);
    // Captured once: `daysAgo` reads the real clock, so calling it twice would
    // compare two different instants and pass or fail on a millisecond tick.
    const recent = daysAgo(1);
    await seedView(db, imageId, daysAgo(45));
    await seedView(db, imageId, recent);

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await worker.scheduled(scheduledEvent(), env);

    // Read back through the DAO the service writes through: the log line is the
    // handler's claim, the surviving row is the evidence.
    const views = new ImageViewsDAO(db as unknown as D1Database);
    const survivors = await views.listForImage(imageId, OWNER);
    expect(survivors.map((view) => view.viewed_at)).toEqual([recent]);

    expect(info).toHaveBeenCalledWith('View-log prune complete.', expect.objectContaining({ cron: '17 3 * * *', deleted: 1 }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the backlog hits the ceiling, because a capped run is not a clean one', async () => {
    const { db, env } = fakeEnv();
    const imageId = await seedImage(db);
    const backlog = VIEW_LOG_PRUNE_MAX_BATCHES * VIEW_LOG_PRUNE_BATCH_SIZE + 1;
    for (let index = 0; index < backlog; index += 1) {
      await seedView(db, imageId, daysAgo(60));
    }

    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await worker.scheduled(scheduledEvent(), env);

    // The ceiling exists so one invocation cannot outrun its budget; the warn is
    // what keeps the deferred remainder visible instead of inferring it from a
    // log that is only shrinking faster than it should.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('batch ceiling'),
      expect.objectContaining({ deleted: VIEW_LOG_PRUNE_MAX_BATCHES * VIEW_LOG_PRUNE_BATCH_SIZE }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it('propagates a failure instead of reporting a completed run', async () => {
    // A binding that is absent at runtime is the honest stand-in: it is exactly
    // the shape the platform hands over when something is misconfigured, and the
    // handler must reject so the invocation is marked failed.
    const { env } = fakeEnv({ ImageHostDB: undefined });

    await expect(worker.scheduled(scheduledEvent(), env)).rejects.toThrow(/Failed to delete old rows from image_views/);
  });
});
