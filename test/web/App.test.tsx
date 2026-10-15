import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '@image-host/web/App';
import { resetCurrentUserProbeForTests } from '@image-host/web/services/userService';
import { urlOf } from '../helpers/fetchUrl';

/**
 * The three-state contract.
 *
 * `null` while the probe is in flight is the third state, and it is what stops the
 * anonymous view flashing on every authenticated load. These tests assert each of
 * the three separately, because a two-state implementation passes "anonymous" and
 * "authenticated" and still fails in the browser.
 */
function stubMe(response: () => Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('/user/me')) return response();
    if (url.includes('/user/images')) {
      return Response.json(
        { success: true, data: [], page: 0, pageSize: 20, total: 0 },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

describe('App auth states', () => {
  beforeEach(() => resetCurrentUserProbeForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows nothing but the session check while the probe is pending', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes('/user/me')) {
          await gate;
          return json({ email: 'owner@example.com' });
        }
        return json({ success: true, data: [], page: 0, pageSize: 20, total: 0 });
      }),
    );

    render(<App />);

    // Not the landing page and not the console — the probe has not answered yet.
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign in to upload/i)).not.toBeInTheDocument();

    release?.();
    await waitFor(() => expect(screen.getByText('owner@example.com')).toBeInTheDocument());
  });

  it('shows the anonymous landing page when the probe rejects', async () => {
    stubMe(() => Promise.reject(new Error('no session')));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/sign in to upload/i)).toBeInTheDocument());
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
  });

  it('treats a 401 as anonymous', async () => {
    stubMe(() => Promise.resolve(json({ Exception: { Type: 'Unauthorized', Message: 'no' } }, 401)));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/sign in to upload/i)).toBeInTheDocument());
  });

  it('treats the Access login page as anonymous, not as an error', async () => {
    // Cloudflare Access answers an unauthenticated `/user/*` request with a
    // redirect to its login page, and `fetch` follows it — so the SPA receives
    // HTML. Treating that as a parse failure rather than "not signed in" is what
    // would put a login page's markup in front of the user.
    stubMe(() => Promise.resolve(new Response('<!doctype html><title>Access</title>', { status: 200 })));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/sign in to upload/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('<!doctype');
  });

  it('shows the console when the probe resolves', async () => {
    stubMe(() => Promise.resolve(json({ email: 'owner@example.com' })));
    render(<App />);
    await waitFor(() => expect(screen.getByText('owner@example.com')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /upload/i })).toBeInTheDocument();
    expect(screen.queryByText(/sign in to upload/i)).not.toBeInTheDocument();
  });

  it('points the sign-in affordance at the Access entry point', async () => {
    stubMe(() => Promise.resolve(json({ Exception: {} }, 401)));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/sign in to upload/i)).toBeInTheDocument());
    // `/user/` is the path Cloudflare Access is configured to intercept; `/` is not.
    expect(screen.getByRole('button', { name: /sign in to upload/i }).closest('a')).toHaveAttribute('href', '/user/');
  });
});

describe('loadCurrentUser deduplication', () => {
  beforeEach(() => resetCurrentUserProbeForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues one probe for concurrent callers', async () => {
    // StrictMode mounts effects twice. Without dedup the console would render on
    // whichever probe resolved last, and the network would see two.
    const fetchMock = stubMe(() => Promise.resolve(json({ email: 'owner@example.com' })));
    const { loadCurrentUser } = await import('@image-host/web/services/userService');
    await Promise.all([loadCurrentUser(), loadCurrentUser(), loadCurrentUser()]);
    expect(fetchMock.mock.calls.filter((call) => urlOf(call[0] ?? '/').includes('/user/me'))).toHaveLength(1);
  });

  it('re-fetches after the first settles', async () => {
    const fetchMock = stubMe(() => Promise.resolve(json({ email: 'owner@example.com' })));
    const { loadCurrentUser } = await import('@image-host/web/services/userService');
    await loadCurrentUser();
    await loadCurrentUser();
    expect(fetchMock.mock.calls.filter((call) => urlOf(call[0] ?? '/').includes('/user/me'))).toHaveLength(2);
  });
});
