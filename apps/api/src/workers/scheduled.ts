import { createRequestScope, Tokens } from '@image-host/backend-services/composition';
import { log } from '@image-host/shared/utils/Logger';

/**
 * The daily `image_views` retention prune.
 *
 * ### Why a cron trigger and not a Durable Object alarm
 *
 * The family uses both, and they are not interchangeable: AWS-AccessBridge and
 * Edge-Git reserve alarms for entity-scoped deferred work — a pushed commit's
 * check queue, a 30-second ticket's garbage collection — where the DO owns
 * state, needs sub-minute latency and single-flight, and requeues with an
 * attempt count. Their periodic sweeps are all cron, and so is this one.
 *
 * The prune has none of those properties. It is a periodic, global, idempotent
 * delete: two overlapping runs are harmless (both delete old rows; one reports
 * the remainder), and a failed run needs no retry because the next day's run
 * already covers it — a self-rescheduling alarm would only add a chain of
 * dependent runs where a cron tick is independent. Adding a Durable Object here
 * would mean a binding, a migration block and a coverage requirement for a loop
 * of SQL statements.
 *
 * The trigger itself lives in `apps/api/wrangler.template.jsonc` as
 * `triggers.crons`, and `ensureConfigCoversTemplate` refuses a materialized
 * config that has dropped it — a prune that silently never runs is exactly the
 * failure the coverage check exists to catch.
 *
 * ### Failure behaviour
 *
 * Deliberately no `try`/`catch`: a throw marks the invocation failed and shows
 * up in observability, whereas a swallowed error would leave only the absence of
 * a log line to infer from. Rows already deleted stay deleted — the prune is a
 * sequence of independent batches, and the next run continues where this one
 * stopped.
 */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const scope = createRequestScope(env);
  const retention = await scope.get(Tokens.ViewLogRetentionService);

  const { deleted, batches, capped } = await retention.prune();

  if (capped) {
    // `warn`, not `info`: the run stopped at the ceiling, so the window may not
    // be held and there may be a backlog left. Only the next run can tell —
    // which is why this is a warning rather than a silent success.
    log.warn('View-log prune hit the batch ceiling; the remainder drains on the next run.', {
      cron: event.cron,
      deleted,
      batches,
    });
    return;
  }
  log.info('View-log prune complete.', { cron: event.cron, deleted, batches });
}
