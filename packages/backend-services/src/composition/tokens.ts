import type { ImagesDAO, ImageViewsDAO } from '@image-host/backend-data/dao';
import type { ImageService } from '../image';
import type { ViewLogRetentionService } from '../maintenance';
import type { ImageHostAuthService } from '../auth';

/**
 * The DI tokens.
 *
 * Each is declared as a top-level `const X: unique symbol` rather than as a
 * property of an `as const` object. That is not a style preference: `Symbol()`
 * in an object-literal property position widens to plain `symbol` even under
 * `as const`, and a `symbol`-typed key collapses `TokenMap`'s entries into one
 * union — so `TokenMap[Tokens.ImagesDAO]` would be
 * `ImagesDAO | ImageViewsDAO | ImageService | ImageHostAuthService` and every
 * `scope.get(...)` call site would need a cast. The explicit annotation is what
 * keeps each entry individually addressable.
 *
 * Symbols rather than strings for the ordinary reason: a typo in a string key
 * produces `undefined` at the `get()` and a `TypeError` three frames later,
 * whereas a typo in a symbol key is a compile error.
 */
const IMAGES_DAO: unique symbol = Symbol('ImagesDAO');
const IMAGE_VIEWS_DAO: unique symbol = Symbol('ImageViewsDAO');
const IMAGE_SERVICE: unique symbol = Symbol('ImageService');
const VIEW_LOG_RETENTION_SERVICE: unique symbol = Symbol('ViewLogRetentionService');
const IMAGE_HOST_AUTH_SERVICE: unique symbol = Symbol('ImageHostAuthService');

export const Tokens = {
  ImagesDAO: IMAGES_DAO,
  ImageViewsDAO: IMAGE_VIEWS_DAO,
  ImageService: IMAGE_SERVICE,
  ViewLogRetentionService: VIEW_LOG_RETENTION_SERVICE,
  ImageHostAuthService: IMAGE_HOST_AUTH_SERVICE,
} as const;

/**
Every public token. A route may only ask the container for one of these.
*/
export type Token =
  typeof IMAGES_DAO | typeof IMAGE_VIEWS_DAO | typeof IMAGE_SERVICE | typeof VIEW_LOG_RETENTION_SERVICE | typeof IMAGE_HOST_AUTH_SERVICE;

/**
What each token resolves to. Keeps `Container.get` typed without a cast per call.
*/
export interface TokenMap {
  [IMAGES_DAO]: ImagesDAO;
  [IMAGE_VIEWS_DAO]: ImageViewsDAO;
  [IMAGE_SERVICE]: ImageService;
  [VIEW_LOG_RETENTION_SERVICE]: ViewLogRetentionService;
  [IMAGE_HOST_AUTH_SERVICE]: ImageHostAuthService;
}
