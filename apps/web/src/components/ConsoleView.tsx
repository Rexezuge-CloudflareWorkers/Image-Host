import { useState } from 'react';
import { uploadImage } from '../services/imageService';
import { BackendError } from '../lib/api';
import { UPLOAD_ACCEPT, describeUploadProblem } from '../lib/upload';
import { useFileDrop } from '../hooks/useFileDrop';
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
 *
 * The zone is a `<label>` around the file input rather than a click target of its
 * own: clicking it opens the picker and the keyboard reaches the input, so the
 * drop is an addition to one control rather than a second, half-working one.
 */
export function ConsoleView({ email }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pickerKey, setPickerKey] = useState(0);

  /**
   * The one place a file becomes the pending upload, however it arrived.
   *
   * Returns whether it was accepted, which is what lets the picker clear its own
   * control after a refusal: an input already holding that file does not fire
   * `change` when the same file is picked again, so the refusal could not be
   * retried without a page reload.
   */
  function choose(candidate: File): boolean {
    const problem = describeUploadProblem(candidate);
    if (problem) {
      // Reported without touching the selection: a file the user already had
      // ready is not what was wrong with the one just offered.
      setMessage({ text: problem, kind: 'error' });
      return false;
    }
    // An error belongs to the file that produced it, and that file is no longer
    // the pending one. A share link from an earlier upload is not an error, and
    // stays on screen until the next upload replaces it.
    setMessage((previous) => (previous?.kind === 'error' ? null : previous));
    setFile(candidate);
    return true;
  }

  /**
  Disabled while uploading: a drop that lands mid-upload is ignored, not queued.
  */
  const drop = useFileDrop({ onFile: choose, enabled: !submitting });

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
          <label className={drop.dragging ? 'dropzone dragging' : 'dropzone'} {...drop.handlers}>
            <span className="dropzone-hint">{drop.dragging ? 'Drop to Choose' : 'Drag and Drop, or Choose a File'}</span>
            {/* Visually hidden, not `display: none`: the input stays focusable and
                the label click still opens the picker, which is what makes the
                whole zone a control rather than a picture of one. */}
            <input
              key={pickerKey}
              type="file"
              accept={UPLOAD_ACCEPT}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked && !choose(picked)) {
                  // A refused file must not stay in the control: an input still
                  // holding it does not fire `change` when the same file is
                  // offered again, so the refusal could not be retried. A new key
                  // is a file input's way of being emptied — `value = ''` says the
                  // same thing, but jsdom pins `files` onto the element, so the
                  // remount is the version whose result a test can see.
                  setPickerKey((value) => value + 1);
                }
              }}
              aria-label="Choose a file to upload"
            />
            <span className="dropzone-file">{file ? file.name : 'No File Chosen'}</span>
          </label>
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
