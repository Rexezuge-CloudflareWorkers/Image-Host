import { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import { ImageService } from '../image';
import { ImageHostAuthService } from '../auth';
import { TelegramClient } from '@image-host/provider-clients/telegram';
import { TELEGRAM_CHAT_ID_VAR, TELEGRAM_SECRETS_BINDING, TELEGRAM_TOKEN_SECRET } from '@image-host/shared/constants';
import { Tokens, type Token, type TokenMap } from './tokens';
import type { ServiceEnv } from './ServiceEnv';

/**
 * A memoizing service container.
 *
 * Every getter caches its instance, so a request that touches `ImageService` and
 * then `ImagesDAO` shares one of each. That is not micro-optimisation: the
 * Telegram client is constructed with the bot token, and minting a second one per
 * `get` would be a second chance to read a half-initialised binding.
 *
 * ### Why the cache stores promises
 *
 * Reading a secret is asynchronous, so `get` is async — and an async getter that
 * awaited its factory *after* writing the instance would hand two concurrent
 * callers two sets of services. The promise is what gets cached, so the factory
 * runs once and both callers observe the same result.
 *
 * A cached rejection is sticky for the same reason, and that is correct here: the
 * binding a factory failed on will still be absent on the next request, so every
 * caller in this request should see the same named error rather than a second
 * attempt producing a different one.
 */
const TELEGRAM_CLIENT: unique symbol = Symbol('TelegramClient');

export class Container {
  private readonly instances = new Map<symbol, Promise<unknown>>();

  /**
   * One factory per public token.
   *
   * A mapped type rather than a `switch`, so adding a token to `Tokens` without
   * adding a factory here is a **compile error** rather than a `get` that
   * returns `undefined` at the first request that reaches it. The `as` casts are
   * confined to this object, where the mapped type has just proved each factory's
   * return type.
   */
  private readonly factories: { [K in Token]: () => Promise<TokenMap[K]> } = {
    [Tokens.ImagesDAO]: async () => new ImagesDAO(this.env.ImageHostDB),
    [Tokens.ImageViewsDAO]: async () => new ImageViewsDAO(this.env.ImageHostDB),
    [Tokens.ImageService]: async () =>
      new ImageService(this.env, await this.get(Tokens.ImagesDAO), await this.telegramClient(), await this.get(Tokens.ImageViewsDAO)),
    [Tokens.ImageHostAuthService]: async () => new ImageHostAuthService(this.env),
  };

  constructor(private readonly env: ServiceEnv) {}

  public async get<K extends Token>(token: K): Promise<TokenMap[K]> {
    const existing = this.instances.get(token);
    if (existing !== undefined) return existing as Promise<TokenMap[K]>;
    const instance = this.factories[token]();
    this.instances.set(token, instance);
    return instance;
  }

  /**
   * The Telegram client, memoized under a private key.
   *
   * Routes are banned from importing `provider-clients` by the lint boundary, and
   * keeping the key off the public token table is what makes that ban true by
   * construction rather than by convention: this is the only place a client is
   * constructed, and no public token hands one out.
   *
   * The token is resolved here rather than at the first `fetch`, so a missing
   * binding is a 500 that names the secret instead of an upstream `BadGatewayError`
   * that reads like Telegram being down.
   *
   * `IMAGE_HOST_SECRETS` is a `SecretsStoreSecret`, **not** a record of the
   * store's contents: it carries no readable properties and hands the value over
   * through an async `get()` that rejects when the secret is absent. That is the
   * whole reason this is an `await` in a `try` rather than a property read behind
   * a falsy check — `env.IMAGE_HOST_SECRETS.TELEGRAM_BOT_TOKEN` is `undefined` on
   * every request, including the ones where the secret is present and correct.
   */
  private async telegramClient(): Promise<TelegramClient> {
    const existing = this.instances.get(TELEGRAM_CLIENT);
    if (existing !== undefined) return existing as Promise<TelegramClient>;

    let token: string;
    try {
      token = await this.env.IMAGE_HOST_SECRETS.get();
    } catch (error) {
      // `get()` takes no name argument, so a failure here can only be reported as
      // this secret inside this binding.
      throw new Error(
        `Secrets Store secret "${TELEGRAM_TOKEN_SECRET}" (binding ${TELEGRAM_SECRETS_BINDING}) could not be read: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    if (!token) {
      throw new Error(`Secrets Store secret "${TELEGRAM_TOKEN_SECRET}" is empty.`);
    }

    const chatId = this.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error(`Var ${TELEGRAM_CHAT_ID_VAR} is missing.`);

    const client = new TelegramClient({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });
    this.instances.set(TELEGRAM_CLIENT, Promise.resolve(client));
    return client;
  }
}

/**
The composition root: one container per request.
*/
export function createRequestScope(env: ServiceEnv): Container {
  return new Container(env);
}

export { type ServiceEnv } from './ServiceEnv';
