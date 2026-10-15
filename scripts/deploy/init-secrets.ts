#!/usr/bin/env tsx

/**
 * Creates the Secrets Store entries declared in `wrangler.jsonc`, for any that do
 * not exist yet.
 *
 * Requires a materialized `wrangler.jsonc`; run `prepare-wrangler-config.ts`
 * first. Fails rather than skipping when the config is missing, because the
 * deploy step that reports "Secret initialization complete" having created
 * nothing is worse than a named error.
 *
 * ### The one difference from the family's version
 *
 * Every other repository's secrets are *generated*: an AES key, an HMAC secret —
 * values that have no canonical form and so can only be made once. A Telegram bot
 * token is not like that. It is issued by `@BotFather` and is the only credential
 * the group will accept uploads from, so this script cannot invent one.
 *
 * `resolveTelegramBotToken` therefore *supplies* the value rather than generating
 * it, reading it from the environment. That changes the contract of the map from
 * "generate a value for this secret" to "here is how this secret becomes
 * available", which is the only honest shape for a credential that exists
 * elsewhere. An absent value throws a message naming the secret, because the
 * alternative — silently skipping — produces a deploy that succeeds and an upload
 * that 502s forever.
 *
 * The create-if-absent semantics are untouched: an existing token is never
 * overwritten by a redeploy.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { isEmptySecretsStoreListing, parseWranglerTableRows } from '../lib/wrangler-table';

interface WranglerConfig {
  secrets_store_secrets?: Array<{
    binding: string;
    store_id: string;
    secret_name: string;
  }>;
}

/**
The env var the deploy pipeline reads the bot token from.
*/
const TELEGRAM_TOKEN_ENV_VAR = 'TG_BOT_TOKEN';

/**
 * Resolves each secret this script knows how to provide.
 *
 * Anything absent from this map must be supplied some other way, so an
 * unrecognised name fails with a named error rather than provisioning an unusable
 * value.
 */
const SECRET_RESOLVERS: Readonly<Record<string, () => Promise<string>>> = {
  'image-host-telegram-bot-token': resolveTelegramBotToken,
};

/**
 * The bot token, from the environment.
 *
 * Trimmed and non-empty checked: a newline picked up from a multi-line secret
 * would be stored verbatim and then produce a `404 Not Found` from Telegram on
 * the first upload — Telegram answers 404 when the token in the URL does not
 * resolve to a bot, and its description is the bare string `Not Found`, which
 * reads as a missing *method* rather than a bad credential.
 */
async function resolveTelegramBotToken(): Promise<string> {
  const token = (process.env[TELEGRAM_TOKEN_ENV_VAR] ?? '').trim();
  if (!token) {
    throw new Error(
      `Secret "image-host-telegram-bot-token" does not exist and could not be created: ${TELEGRAM_TOKEN_ENV_VAR} is not set. ` +
        `Issue a token with @BotFather and add it as the ${TELEGRAM_TOKEN_ENV_VAR} repository secret.`,
    );
  }
  return token;
}

/**
 * Runs a wrangler subcommand, optionally feeding `input` on stdin.
 *
 * Arguments are passed as an argv array rather than interpolated into a shell
 * string, so a value containing shell metacharacters cannot alter the command.
 */
function wrangler(args: string[], input?: string): string {
  try {
    // `pnpm` is intentionally resolved from PATH. Arguments are passed as an argv
    // array, never interpolated into a shell string, so argument injection is not possible.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input !== undefined && { input }),
    });
  } catch (error: unknown) {
    const maybeProcessError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = maybeProcessError.stdout ? maybeProcessError.stdout.toString() : '';
    const stderr = maybeProcessError.stderr ? maybeProcessError.stderr.toString() : '';
    throw new Error(`Command failed: pnpm exec wrangler ${args.join(' ')}\n${stdout}${stderr || maybeProcessError.message || ''}`);
  }
}

function parseWranglerConfig(): WranglerConfig {
  const configPath = path.join(process.cwd(), 'wrangler.jsonc');
  let content: string;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(
      `${configPath} not found. Run scripts/deploy/prepare-wrangler-config.ts first — it is what creates the file this script reads.`,
    );
  }

  // `parse` is error-tolerant and returns a partial object, so an empty result
  // means malformed JSON rather than "no secrets declared". Treating it as an
  // empty list would report success having created nothing.
  const errors: ParseError[] = [];
  const config = parse(content, errors, { allowTrailingComma: true }) as WranglerConfig;
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${configPath} is not valid JSONC: ${errors.length} parse error(s), first at offset ${first?.offset}. Run prepare-wrangler-config.ts to regenerate it.`,
    );
  }
  return config;
}

/**
 * Lists the secret names present in a Secrets Store.
 *
 * Returns `undefined` when the listing itself failed, which is deliberately
 * distinct from an empty list: a transient CLI failure must not be read as "the
 * secret is missing" and cause a duplicate insert. An empty store *is* a
 * confirmed absence, so it maps to an empty set rather than `undefined`.
 */
function listSecretNames(storeId: string): Set<string> | undefined {
  let output: string;
  try {
    output = wrangler(['secrets-store', 'secret', 'list', storeId, '--remote']);
  } catch (error: unknown) {
    if (isEmptySecretsStoreListing(error)) {
      console.log(`Secrets Store ${storeId} is empty`);
      return new Set();
    }
    console.warn(`Unable to list secrets in store ${storeId}:`, error instanceof Error ? error.message : 'unknown error');
    return undefined;
  }

  // The name is the first column, taken exactly: a substring match would let
  // `image-host-telegram-bot-token-2` satisfy a search for
  // `image-host-telegram-bot-token`.
  const names = new Set<string>();
  for (const row of parseWranglerTableRows(output)) {
    const name = row[0];
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function createSecret(storeId: string, secretName: string, secretValue: string): void {
  console.log(`Creating secret: ${secretName}`);
  // The value is passed on stdin, not as a shell argument. Interpolating it into
  // a command string would expose the secret in the process table and in any
  // process-argv logging on the runner.
  wrangler(['secrets-store', 'secret', 'create', storeId, '--name', secretName, '--scopes', 'workers', '--remote'], secretValue);
}

async function main(): Promise<void> {
  console.log('Initializing Cloudflare secrets...');
  const config: WranglerConfig = parseWranglerConfig();
  const listedByStore = new Map<string, Set<string> | undefined>();

  const declaredSecrets = config.secrets_store_secrets ?? [];
  if (declaredSecrets.length === 0) {
    throw new Error('wrangler.jsonc declares no secrets_store_secrets entries, so there is nothing to initialize.');
  }

  for (const secret of declaredSecrets) {
    if (!listedByStore.has(secret.store_id)) {
      listedByStore.set(secret.store_id, listSecretNames(secret.store_id));
    }
    const existing = listedByStore.get(secret.store_id);
    if (existing === undefined) {
      // Refuse to guess: creating a secret we could not read back risks
      // overwriting a live value with a freshly supplied one.
      throw new Error(
        `Could not list secrets in store ${secret.store_id}; refusing to create ${secret.secret_name} without confirming it is absent.`,
      );
    }
    if (existing.has(secret.secret_name)) {
      console.log(`Secret ${secret.secret_name} already exists`);
      continue;
    }

    const resolve = SECRET_RESOLVERS[secret.secret_name];
    if (!resolve) {
      throw new Error(`Unknown secret: ${secret.secret_name}. Add a resolver in scripts/deploy/init-secrets.ts.`);
    }
    const secretValue = await resolve();
    console.log(`Resolved value for ${secret.secret_name}`);
    createSecret(secret.store_id, secret.secret_name, secretValue);
    existing.add(secret.secret_name);
  }
  console.log('Secret initialization complete');
}

// Top-level await rather than `.catch()`, so a rejected `main` surfaces as a
// stack trace with its cause intact. Either way the process must exit non-zero:
// this runs in the deploy pipeline, and swallowing the rejection reported a
// failed bootstrap as a green step that `retry-step` would not retry.
try {
  await main();
} catch (error: unknown) {
  console.error('Secret initialization failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
