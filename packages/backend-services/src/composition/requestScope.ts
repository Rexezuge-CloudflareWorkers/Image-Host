import { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import { ImageService } from '../image';
import { ImageHostAuthService } from '../auth';
import { TelegramClient } from '@image-host/provider-clients/telegram';
import { Tokens, type Token, type TokenMap } from './tokens';
import type { ServiceEnv } from './ServiceEnv';

/**
 * A memoizing service container.
 *
 * Every getter caches its instance, so a request that touches `ImageService` and
 * then `ImagesDAO` shares one of each. That is not micro-optimisation: the
 * Telegram client is constructed with the bot token, and minting a second one per
 * `get` would be a second chance to read a half-initialised binding.
 */
const TELEGRAM_CLIENT: unique symbol = Symbol('TelegramClient');

export class Container {
  private readonly instances = new Map<symbol, unknown>();

  /**
   * One factory per public token.
   *
   * A mapped type rather than a `switch`, so adding a token to `Tokens` without
   * adding a factory here is a **compile error** rather than a `get` that
   * returns `undefined` at the first request that reaches it. The `as` casts are
   * confined to this object, where the mapped type has just proved each factory's
   * return type.
   */
  private readonly factories: { [K in Token]: () => TokenMap[K] } = {
    [Tokens.ImagesDAO]: () => new ImagesDAO(this.env.ImageHostDB),
    [Tokens.ImageViewsDAO]: () => new ImageViewsDAO(this.env.ImageHostDB),
    [Tokens.ImageService]: () =>
      new ImageService(this.env, this.get(Tokens.ImagesDAO), this.telegramClient(), this.get(Tokens.ImageViewsDAO)),
    [Tokens.ImageHostAuthService]: () => new ImageHostAuthService(this.env),
  };

  constructor(private readonly env: ServiceEnv) {}

  public get<K extends Token>(token: K): TokenMap[K] {
    const existing = this.instances.get(token);
    if (existing !== undefined) return existing as TokenMap[K];
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
   */
  private telegramClient(): TelegramClient {
    const existing = this.instances.get(TELEGRAM_CLIENT);
    if (existing !== undefined) return existing as TelegramClient;

    // Validated here rather than at the first `fetch`, so a missing binding is a
    // 500 that names the binding instead of an upstream `BadGatewayError` that
    // reads like Telegram being down.
    const token = this.env.IMAGE_HOST_SECRETS?.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('Secrets Store binding IMAGE_HOST_SECRETS.TELEGRAM_BOT_TOKEN is missing.');
    const chatId = this.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error('Var TELEGRAM_CHAT_ID is missing.');

    const client = new TelegramClient({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });
    this.instances.set(TELEGRAM_CLIENT, client);
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
