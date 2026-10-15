/**
 * A failed API call, carrying the status and the `Exception` envelope's type.
 *
 * The two are kept apart because the SPA branches on both: the status decides
 * whether to offer a sign-in, and the type decides what to say about it.
 */
export class BackendError extends Error {
  readonly status: number;
  readonly errorType: string | null;

  constructor(message: string, status: number, errorType: string | null) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.errorType = errorType;
  }
}

const MAX_MESSAGE_CHARS = 500;

/**
 * Turns a non-2xx body into a readable message.
 *
 * The final `catch` matters more than it looks. When Cloudflare Access is in front
 * of `/user/*`, an unauthenticated request is answered with a **redirect to the
 * login page**, and `fetch` follows it — so the body arriving here is the login
 * page's HTML, not JSON. Parsing it throws, and without this branch the raw HTML
 * would become the error message and then the rendered error text.
 *
 * That is exactly the shape the auth probe relies on: anything that is not a 200
 * JSON `CurrentUser` means "not authenticated", including this case.
 */
function extractErrorMessage(payloadText: string, status: number): { message: string; type: string | null } {
  if (!payloadText) return { message: `HTTP ${status}`, type: null };

  const truncate = (value: string): string => (value.length > MAX_MESSAGE_CHARS ? `${value.slice(0, MAX_MESSAGE_CHARS)}…` : value);

  try {
    const data = JSON.parse(payloadText) as {
      Exception?: { Type?: string; Message?: string };
      success?: boolean;
      message?: string;
      error?: string;
    };
    const type = typeof data?.Exception?.Type === 'string' && data.Exception.Type.length > 0 ? data.Exception.Type : null;
    const exceptionMessage = data?.Exception?.Message;
    if (typeof exceptionMessage === 'string' && exceptionMessage.length > 0) {
      return { message: truncate(exceptionMessage), type };
    }
    const legacy = data?.message ?? data?.error;
    if (typeof legacy === 'string' && legacy.length > 0) {
      return { message: truncate(legacy), type };
    }
    if (type) return { message: `${type} (HTTP ${status})`, type };
  } catch {
    // Not JSON: the Access login page, or a proxy's plain-text error. Surface it
    // truncated as-is rather than pretending it parsed.
  }
  return { message: truncate(payloadText) || `HTTP ${status}`, type: null };
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    const { message, type } = extractErrorMessage(text, response.status);
    throw new BackendError(message, response.status, type);
  }
  return await response.json();
}

export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Skipped rather than sent empty: `?q=` and an absent `q` are different
    // requests server-side, and only one of them is a search.
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const query = params ? buildQuery(params) : '';
  return readJson<T>(await fetch(`${path}${query}`));
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return readJson<T>(
    await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
Uploads a `FormData` body. `Content-Type` is deliberately unset so the browser adds the boundary.
*/
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  return readJson<T>(await fetch(path, { method: 'POST', body: formData }));
}
