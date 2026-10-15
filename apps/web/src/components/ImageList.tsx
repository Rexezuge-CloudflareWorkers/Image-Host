import { useCallback, useEffect, useState } from 'react';
import type { ImageView } from '../types';
import { listImages, deleteImage, setImageBlocked } from '../services/imageService';
import { BackendError } from '../lib/api';

interface Props {
  email: string;
}

type Busy = 'idle' | 'loading' | 'error';

/**
 * The owner's image list.
 *
 * Optimistic about nothing on purpose: `delete` and `block` both await the server
 * and then reload. An optimistic delete that the server rejects — and it can, with
 * a 404 — would leave a row in the list that no longer exists, and the reload is
 * one request on a list the user is already looking at.
 */
export function ImageList({ email }: Props) {
  const [images, setImages] = useState<ImageView[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listImages(0, query.trim() || undefined);
      setImages(page.data);
      setTotal(page.total);
      setBusy('idle');
      setError(null);
    } catch (caught) {
      setBusy('error');
      setError(caught instanceof BackendError ? caught.message : 'Unable to load your images.');
    }
  }, [query]);

  /**
   * The fetch runs inside the effect rather than through `load`.
   *
   * `load` also flips `busy` to `loading`, and calling it synchronously from the
   * effect body would `setState` during the commit phase — a cascading render on
   * every mount and every keystroke in the search box. `busy` starts as `loading`
   * already, so the effect only needs to wait for the result.
   *
   * The `active` flag drops a response that arrives after unmount, which under
   * StrictMode's double-mount would otherwise warn and can resurrect stale rows.
   */
  useEffect(() => {
    let active = true;
    listImages(0, query.trim() || undefined)
      .then((page) => {
        if (!active) return;
        setImages(page.data);
        setTotal(page.total);
        setBusy('idle');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setBusy('error');
        setError(caught instanceof BackendError ? caught.message : 'Unable to load your images.');
      });
    return () => {
      active = false;
    };
  }, [query]);

  /**
  Re-query after a mutation, flipping `busy` first because a click can afford it.
  */
  const reload = useCallback(async () => {
    setBusy('loading');
    await load();
  }, [load]);

  // A 401 here means the Zero Trust session expired while the console was open.
  // Reloading the shell re-runs the probe, which is the only thing that can move
  // the app back to the anonymous view.
  function handleExpired(caught: unknown) {
    if (caught instanceof BackendError && caught.status === 401) {
      location.assign('/user/');
      return true;
    }
    return false;
  }

  async function remove(image: ImageView) {
    try {
      await deleteImage(image.id);
      await reload();
    } catch (caught) {
      if (!handleExpired(caught)) setError(caught instanceof Error ? caught.message : 'Delete failed.');
    }
  }

  async function toggleBlocked(image: ImageView) {
    try {
      await setImageBlocked(image.id, !image.blocked);
      await reload();
    } catch (caught) {
      if (!handleExpired(caught)) setError(caught instanceof Error ? caught.message : 'Update failed.');
    }
  }

  return (
    <section className="panel">
      <h2>Your Images{total > 0 ? ` (${total})` : ''}</h2>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by file name"
          aria-label="Search images by file name"
          style={{
            flex: 1,
            padding: '0.45rem 0.6rem',
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            color: 'var(--text)',
          }}
        />
        <button type="button" onClick={() => void reload()} disabled={busy === 'loading'}>
          Refresh
        </button>
      </div>

      {error && <p className="status error">{error}</p>}

      {busy === 'loading' && images.length === 0 && <p className="empty">Loading…</p>}

      {!busy && images.length === 0 && !error && (
        <p className="empty">{query ? `Nothing matches “${query}”.` : 'No images yet. Upload one above.'}</p>
      )}

      {images.length > 0 && (
        <div className="grid">
          {images.map((image) => (
            <article className="card" key={image.id}>
              <div className="thumb" style={image.blocked ? undefined : { backgroundImage: `url("${image.url}")` }}>
                {image.blocked && 'Blocked'}
              </div>
              <div className="meta">
                <div className="name" title={image.fileName}>
                  {image.fileName}
                </div>
                <div className="facts">
                  {image.viewCount} view{image.viewCount === 1 ? '' : 's'} · {new Date(image.createdAt).toLocaleDateString()}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(new URL(image.url, location.origin).href);
                    }}
                  >
                    Copy Link
                  </button>
                  <button type="button" onClick={() => void toggleBlocked(image)}>
                    {image.blocked ? 'Unblock' : 'Block'}
                  </button>
                  <button type="button" className="danger" onClick={() => void remove(image)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="facts" style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: '0.9rem' }}>
        Signed in as {email}. Deleting removes the message from the Telegram group. Sharing is public to anyone holding the link, so treat a
        share link as a capability rather than a secret you can revoke by hiding it.
      </p>
    </section>
  );
}
