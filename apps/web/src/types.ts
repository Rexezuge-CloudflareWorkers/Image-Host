export type { CurrentUser, ImageView, PagedImages } from '@image-host/shared/model';

/**
 * What `GET /user/me` answers. Its presence is the whole auth signal — see
 * `useCurrentUser`, which treats a resolved promise as proof and every rejection
 * as its opposite.
 */
export interface CurrentUserResponse {
  email: string;
}
