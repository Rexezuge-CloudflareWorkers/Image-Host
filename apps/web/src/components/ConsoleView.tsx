import { useState } from 'react';
import { uploadImage } from '../services/imageService';
import { BackendError } from '../lib/api';
import { ImageList } from './ImageList';

interface Props {
  email: string;
}

/**
 * The upload form and the owner's library.
 *
 * `onUploaded` rather than a shared fetch layer: the list owns its own loading and
 * error state, so the form only needs to say "something new arrived" and let the
 * list re-query. Passing the new image down instead would mean two sources of
 * truth for the same list.
 */
export function ConsoleView({ email }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const { image } = await uploadImage(file);
      const absolute = new URL(image.url, location.origin).href;
      setMessage({ text: `Uploaded. Share link: ${absolute}`, kind: 'ok' });
      setFile(null);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      // A 401 means the Zero Trust session lapsed between the probe and the POST.
      // Handled before the generic message because the redirect *is* the response —
      // setting an error on the way out would flash it at the user.
      if (caught instanceof BackendError && caught.status === 401) {
        location.assign('/user/');
        return;
      }
      setMessage({ text: caught instanceof BackendError ? caught.message : 'Upload failed.', kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Upload</h2>
        <form onSubmit={submit}>
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-label="Choose a file to upload" />
          <button type="submit" className="primary" disabled={!file || submitting}>
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </form>
        {message && (
          <p className={`status ${message.kind}`} style={message.kind === 'ok' ? { overflowWrap: 'anywhere' } : undefined}>
            {message.text}
          </p>
        )}
      </section>

      {/* `key` forces a remount so the list re-queries after an upload. */}
      <ImageList key={reloadKey} email={email} />
    </>
  );
}
