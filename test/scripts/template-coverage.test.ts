import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';

/**
 * The template-coverage guard, `ensureConfigCoversTemplate`.
 *
 * The check exists because a `WRANGLER_JSONC` override outlives the template it
 * was copied from: a fork that added a binding, a var or a cron trigger carries
 * a config that never gained it, and the deploy fails later against a live
 * environment — or, worse, does not fail at all and ships a worker whose
 * scheduled cleanup never runs.
 *
 * `CONFIG_PATH`/`TEMPLATE_PATH` are computed from `process.cwd()` at import time,
 * so each case runs in a throwaway directory with a fresh module registry.
 */
const SHIPPED_TEMPLATE = 'apps/api/wrangler.template.jsonc';

describe('ensureConfigCoversTemplate', () => {
  let workdir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workdir = mkdtempSync(path.join(tmpdir(), 'wrangler-coverage-'));
    mkdirSync(path.join(workdir, 'apps/api'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
    delete process.env.WRANGLER_VARS_PATCH_JSON;
    vi.resetModules();
  });

  /**
  The real shipped template, so a case exercises the file that actually deploys.
  */
  function writeRealTemplate(): void {
    copyFileSync(path.join(originalCwd, SHIPPED_TEMPLATE), path.join(workdir, SHIPPED_TEMPLATE));
  }

  function write(template: string, config: string): void {
    writeFileSync(path.join(workdir, 'apps/api/wrangler.template.jsonc'), template);
    writeFileSync(path.join(workdir, 'wrangler.jsonc'), config);
  }

  /**
   * A config exercising every field the guard reads, at the smallest useful size.
   *
   * Kept as an object rather than JSON text so a case can drop one key and leave
   * the rest byte-for-byte intact — regex surgery on JSON silently produces a
   * config that fails for the wrong reason, which is how a guard test ends up
   * asserting nothing.
   */
  const FULL_CONFIG = {
    name: 'image-host',
    d1_databases: [{ binding: 'ImageHostDB', database_id: 'x' }],
    secrets_store_secrets: [{ binding: 'IMAGE_HOST_SECRETS', store_id: 'z' }],
    triggers: { crons: ['17 3 * * *'] },
    vars: {
      ENVIRONMENT: 'production',
      DEMO_MODE: 'false',
      DEV_AUTH_EMAIL: '',
      POLICY_AUD: '',
      TEAM_DOMAIN: '',
      MAX_UPLOAD_BYTES: '20971520',
      VIEW_LOG_RETENTION_DAYS: '30',
      TELEGRAM_CHAT_ID: '',
    },
  };

  /**
   * Every field the guard reads, each optional at the top level only.
   *
   * Hand-written rather than `Partial<typeof FULL_CONFIG>`, which is shallow and
   * would still reject a `vars` literal missing a key — i.e. exactly the edits a
   * case needs to make.
   */
  type ConfigShape = {
    name?: string;
    d1_databases?: Array<{ binding: string; database_id: string }>;
    secrets_store_secrets?: Array<{ binding: string; store_id: string }>;
    triggers?: { crons: string[] };
    vars?: Record<string, string>;
  };

  const TEMPLATE = JSON.stringify(FULL_CONFIG, null, 2);

  /**
  Writes the fixture template with `mutate`'s config as `wrangler.jsonc`.
  */
  function writeWith(mutate: (config: ConfigShape) => ConfigShape): void {
    write(TEMPLATE, JSON.stringify(mutate(structuredClone(FULL_CONFIG)), null, 2));
  }

  async function run(): Promise<void> {
    process.chdir(workdir);
    vi.resetModules();
    const { ensureConfigCoversTemplate } = await import('../../scripts/lib/wrangler-config/template-coverage');
    ensureConfigCoversTemplate();
  }

  /**
   * The guard in its real position: after both patches, before provisioning.
   *
   * `provisionWranglerResources` is deliberately not called — it shells out to
   * wrangler against the live Cloudflare API, which a unit test must not do, and
   * the ordering it would prove (coverage before provisioning) is asserted by the
   * entrypoint's own sequence instead.
   */
  async function runMaterializeSequence(): Promise<void> {
    process.chdir(workdir);
    vi.resetModules();
    const { applyTopLevelPatch, applyVarsPatch, prepareConfigFile } = await import('../../scripts/lib/wrangler-config/patches');
    const { ensureConfigCoversTemplate } = await import('../../scripts/lib/wrangler-config/template-coverage');

    prepareConfigFile();
    applyTopLevelPatch();
    applyVarsPatch();
    ensureConfigCoversTemplate();
  }

  it('passes when the config carries every binding, var and trigger', async () => {
    write(TEMPLATE, TEMPLATE);
    await expect(run()).resolves.toBeUndefined();
  });

  it('passes for the shipped template copied verbatim', async () => {
    // The case that would break CI if the guard and the shipped template
    // disagreed: `prepareConfigFile` copies the template when `WRANGLER_JSONC` is
    // unset, and the guard must accept what it just wrote. Run through the real
    // ordered sequence rather than the guard alone, since the ordering is part of
    // the contract.
    writeRealTemplate();
    await expect(runMaterializeSequence()).resolves.toBeUndefined();
  });

  it('accepts a var supplied by the vars patch, because coverage runs after it', async () => {
    // The documented route for a fork that does not carry the whole file. If the
    // check moved ahead of `applyVarsPatch`, this legitimate config would fail.
    // The fixture carries the retention var too, so dropping one is a real gap the
    // patch has to close.
    writeWith((config) => ({ ...config, vars: { TELEGRAM_CHAT_ID: '' } }));
    process.env.WRANGLER_VARS_PATCH_JSON = JSON.stringify({
      ENVIRONMENT: 'production',
      DEMO_MODE: 'false',
      DEV_AUTH_EMAIL: '',
      POLICY_AUD: '',
      TEAM_DOMAIN: '',
      MAX_UPLOAD_BYTES: '20971520',
      VIEW_LOG_RETENTION_DAYS: '30',
    });

    await expect(runMaterializeSequence()).resolves.toBeUndefined();
  });

  it('fails when the cron trigger is missing', async () => {
    // Only the trigger declares the retention prune to Cloudflare. Nothing else
    // heals its absence: the worker deploys, the handler exists, and the log
    // grows forever because no invocation ever happens.
    writeWith((config) => ({ ...config, triggers: undefined }));
    await expect(run()).rejects.toThrow(/triggers\.crons: crons/);
  });

  it('treats an empty crons list as no trigger', async () => {
    // `triggers: { crons: [] }` schedules nothing, which is the same outcome as
    // omitting the field — so it must not read as coverage.
    writeWith((config) => ({ ...config, triggers: { crons: [] } }));
    await expect(run()).rejects.toThrow(/triggers\.crons: crons/);
  });

  it('fails when a D1 binding is missing', async () => {
    // No binding the worker reads means every request fails on the missing env.
    writeWith((config) => ({ ...config, d1_databases: [] }));
    await expect(run()).rejects.toThrow(/d1_databases\[\]\.binding: ImageHostDB/);
  });

  it('fails when a var is missing, and points at the patch variable', async () => {
    writeWith((config) => {
      const vars = { ...config.vars };
      delete vars.VIEW_LOG_RETENTION_DAYS;
      return { ...config, vars };
    });
    await expect(run()).rejects.toThrow(/vars: VIEW_LOG_RETENTION_DAYS[\s\S]*WRANGLER_VARS_PATCH_JSON/);
  });

  it('compares presence, not values', async () => {
    // A deployment fills these with its own real Zero Trust values through
    // WRANGLER_VARS_PATCH_JSON; an equality check would fail every override.
    writeWith((config) => ({ ...config, vars: { ...config.vars, ENVIRONMENT: 'staging' } }));
    await expect(run()).resolves.toBeUndefined();
  });

  it('reports every gap at once rather than the first', async () => {
    // One run must name the whole resync, not make the reader fix them one deploy
    // at a time.
    write(TEMPLATE, '{ "name": "image-host" }');
    await expect(run()).rejects.toThrow(/ImageHostDB[\s\S]*ENVIRONMENT[\s\S]*crons/);
  });

  it('names the fix, so the failure is actionable', async () => {
    write(TEMPLATE, '{ "name": "image-host" }');
    await expect(run()).rejects.toThrow(/Regenerate it from apps\/api\/wrangler\.template\.jsonc/);
  });

  it('the shipped template declares the trigger, var and binding the guard requires', async () => {
    // The guard is only meaningful while the template still declares the things
    // it compares: removing the trigger from the template would silently stop
    // requiring it in every materialized config, which is the drift the guard
    // exists to catch, one level up.
    const template = parse(readFileSync(path.join(originalCwd, SHIPPED_TEMPLATE), 'utf8')) as {
      triggers?: { crons?: string[] };
      vars?: Record<string, unknown>;
      d1_databases?: Array<{ binding?: string }>;
    };

    expect(template.triggers?.crons?.length).toBeGreaterThan(0);
    expect(template.vars).toHaveProperty('VIEW_LOG_RETENTION_DAYS');
    expect(template.d1_databases?.map((database) => database.binding)).toContain('ImageHostDB');
  });
});
