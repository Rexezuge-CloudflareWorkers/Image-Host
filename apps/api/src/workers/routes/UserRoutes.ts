import type { Hono } from 'hono';
import { BadRequestError } from '@rexezuge/errors';
import { Tokens } from '@image-host/backend-services/composition';
import { ListImagesQuerySchema, SetBlockedSchema, UploadConstraints } from '@image-host/shared/schema';
import { getScope } from '@/middleware';
import type { AppEnv, ImageHostContext } from '@/types';
import { handle } from '@/errors/routeHelpers';

/**
 * The authenticated half of the API. Every route here is owner-scoped: the
 * address comes from the Zero Trust session and is passed into the DAO query, so
 * there is no "fetch then compare" step to forget.
 */
export function registerUserRoutes(app: Hono<AppEnv>): void {
  /**
   * The client's authentication probe.
   *
   * The SPA calls this on mount and renders the anonymous view on any failure —
   * a 401, a redirect to the Access login page, or the login page's HTML. A 200
   * is the only signal that means "authenticated", which is why this route exists
   * separately from the rest of `/user/*` rather than being inferred from them.
   */
  app.get('/user/me', (c) =>
    handle(async () => {
      const email = c.get('AuthenticatedUserEmailAddress');
      return c.json({ email });
    }),
  );

  app.get('/user/images', (c) =>
    handle(async () => {
      const parsed = ListImagesQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        throw new BadRequestError('Invalid query parameters.');
      }
      const images = await getScope(c).get(Tokens.ImageService);
      const page = await images.listOwned(ownerEmail(c), originOf(c), parsed.data.page, parsed.data.pageSize, parsed.data.q);
      return c.json({ success: true, ...page });
    }),
  );

  app.post('/user/images', (c) =>
    handle(async () => {
      const formData = await readForm(c);
      const file = readUploadedFile(formData);
      const images = await getScope(c).get(Tokens.ImageService);
      const { image } = await images.upload(ownerEmail(c), originOf(c), file);
      // 201, not 200: the slug is new and the share link did not exist before.
      return c.json({ success: true, image }, 201);
    }),
  );

  app.delete('/user/images/:id', (c) =>
    handle(async () => {
      const id = parseId(c.req.param('id'));
      await (await getScope(c).get(Tokens.ImageService)).softDelete(ownerEmail(c), id);
      return c.json({ success: true });
    }),
  );

  app.put('/user/images/:id/block', (c) =>
    handle(async () => {
      const id = parseId(c.req.param('id'));
      const body = await readJson(c);
      const parsed = SetBlockedSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestError('Body must be { blocked: boolean }.');
      }
      await (await getScope(c).get(Tokens.ImageService)).setBlocked(ownerEmail(c), id, parsed.data.blocked);
      return c.json({ success: true });
    }),
  );
}

/**
 * The authenticated caller's address.
 *
 * Read from the context rather than re-derived, because `userAuthentication` has
 * already established it and re-running verification here would double the JWKS
 * work per request for no additional guarantee.
 */
function ownerEmail(c: ImageHostContext): string {
  const email = c.get('AuthenticatedUserEmailAddress');
  if (typeof email !== 'string' || email.length === 0) {
    // Unreachable while `userAuthentication` is mounted on `/user/*`. Throwing a
    // 500 rather than reading `undefined` keeps a future unmount from turning
    // into a query scoped to the literal string "undefined".
    throw new Error('AuthenticatedUserEmailAddress is unset. Is userAuthentication mounted on /user/*?');
  }
  return email;
}

function originOf(c: ImageHostContext): string {
  return new URL(c.req.url).origin;
}

/**
 * Parses a path id.
 *
 * Rejects rather than coercing: `Number('12abc')` is `NaN` and `Number('')` is `0`,
 * so a permissive parse turns a malformed URL into a delete of image 0.
 */
function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestError('Invalid image id.');
  }
  return id;
}

/**
 * Parses a JSON body, treating an empty body as `{}`.
 *
 * The lenient default matters for `PUT /user/images/:id/block`, where a client
 * that sends no body at all is asking for a validation error rather than a parse
 * error — the schema then produces the message that names the actual problem.
 */
async function readJson(c: ImageHostContext): Promise<unknown> {
  try {
    const text = await c.req.text();
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new BadRequestError('Body must be valid JSON.');
  }
}

/**
 * Parses a multipart body.
 *
 * A malformed body is a 400 rather than the 500 an unhandled
 * `TypeError: Cannot read properties of undefined` would produce — the boundary
 * between "the client sent something wrong" and "we broke" is exactly what this
 * wrapper exists to hold.
 */
async function readForm(c: ImageHostContext): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throw new BadRequestError('Expected a multipart/form-data body.');
  }
}

/**
The upload file, typed. A missing field is a 400 naming the field the client owes us.
*/
export function readUploadedFile(formData: FormData): File {
  const entry = formData.get(UploadConstraints.fieldName);
  if (!(entry instanceof File)) {
    throw new BadRequestError(`Missing multipart field "${UploadConstraints.fieldName}".`);
  }
  if (entry.size === 0) {
    throw new BadRequestError('Uploaded file is empty.');
  }
  return entry;
}
