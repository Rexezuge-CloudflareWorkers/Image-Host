import type { ImageViewsDAO } from '@image-host/backend-data/dao';
import { VIEW_LOG_PRUNE_BATCH_SIZE, VIEW_LOG_PRUNE_MAX_BATCHES, VIEW_LOG_RETENTION_DAYS } from '@image-host/shared/constants';
import { ConfigurationManager } from '../config';
import type { ServiceEnv } from '../composition/ServiceEnv';

const MS_PER_DAY = 86_400_000;

export interface PruneResult {
  /**
   * Rows deleted by this run.
   */
  deleted: number;
  /**
   * Delete statements issued, whether or not the last one was full.
   */
  batches: number;
  /**
   * True when the loop stopped at the batch ceiling rather than on a short
   * batch. A final batch that came back exactly full is indistinguishable from
   * a drained one until the next call — so this says "the drain may be
   * incomplete", never "rows remain".
   */
  capped: boolean;
}

/**
 * Keeps `image_views` a rolling window.
 *
 * The log is anonymous view telemetry, written per uncached `GET /i/:slug` and
 * read by nothing user-facing, so it is trimmed by age instead of kept forever.
 * `images.view_count` is a separate, lifetime figure and this service never
 * touches it — an owner who sees "12 views" still sees it after the log rows
 * behind that count have aged out.
 *
 * ### Why a service and not the scheduled handler
 *
 * The loop is policy — retention comes from configuration, the batch size and
 * ceiling come from constants, and the "keep going until a short batch" rule is
 * the contract with the DAO. `apps/api` wires the schedule; it does not own the
 * decision about how much to delete. This mirrors the family's pruning tasks
 * (`AbstractPruningTask` in AWS-AccessBridge and Edge-Git), minus the task
 * registry: there is one task here, so a registry would be ceremony.
 */
export class ViewLogRetentionService {
  constructor(
    private readonly env: ServiceEnv,
    private readonly views: ImageViewsDAO,
  ) {}

  /**
   * Deletes rows older than the retention window, one batch at a time.
   *
   * Loops until a batch comes back short of the batch size — the same terminal
   * condition the family's pruning tasks use, and the reason the DAO's count
   * must be honest: `0` is "nothing old enough", so a table with a genuine
   * backlog can never report a clean run without having drained it. The loop
   * stops early at the batch ceiling so one invocation cannot outrun its
   * subrequest and wall-clock budgets; `capped` reports that rows were left.
   */
  public async prune(now: Date = new Date()): Promise<PruneResult> {
    const days = ConfigurationManager.telemetry.getViewLogRetentionDays(this.env, VIEW_LOG_RETENTION_DAYS);
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();

    let deleted = 0;
    let batches = 0;
    while (batches < VIEW_LOG_PRUNE_MAX_BATCHES) {
      const batch = await this.views.pruneOlderThanBatch(cutoff, VIEW_LOG_PRUNE_BATCH_SIZE);
      batches += 1;
      deleted += batch;
      if (batch < VIEW_LOG_PRUNE_BATCH_SIZE) {
        return { deleted, batches, capped: false };
      }
    }
    return { deleted, batches, capped: true };
  }
}
