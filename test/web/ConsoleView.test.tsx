import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UploadConstraints } from '@image-host/shared/schema';
import { ConsoleView } from '@image-host/web/components/ConsoleView';
import { urlOf } from '../helpers/fetchUrl';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Content-Type': 'application/json' } });

const UPLOADED = { success: true, image: { id: 1, url: '/i/abcdefghijklmnop', fileName: 'cat.png' } };

/**
 * A drag event carrying a `dataTransfer` stub.
 *
 * Built by hand rather than through `fireEvent.drop(zone, { dataTransfer })`.
 * `@testing-library/dom` does copy a `dataTransfer` from that init, but it does so
 * with `defineProperty` and no `writable`, and the hook assigns `dropEffect` to
 * the object the way a real `DataTransfer` allows — an assignment that would throw
 * out of the test rather than fail it. This stub is writable, like the real one.
 */
function dragEvent(type: string, init: { types?: string[]; files?: File[] } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { writable: true, value: { types: init.types ?? ['Files'], files: init.files ?? [] } });
  return event;
}

/**
 * The drop zone itself — the `<label>` the file input lives in.
 *
 * Found through the input rather than by adding a test id, because the zone and
 * the control being the same thing is the point: an implementation that moved the
 * drag handlers onto a sibling would fail to resolve this at all.
 */
function zone(): HTMLElement {
  const label = screen.getByLabelText('Choose a file to upload').closest('label');
  if (!label) throw new Error('The file input is not inside the drop zone.');
  return label;
}

function posts(fetchMock: ReturnType<typeof stubFetch>): RequestInit[] {
  return fetchMock.mock.calls.map((call) => call[1] as RequestInit | undefined).filter((init) => init?.method === 'POST') as RequestInit[];
}

/**
 * A request that never settles.
 *
 * The library list is not what this suite is about, and it outlives most of these
 * tests: `ImageList` would set state after the assertion and report an `act()` the
 * suite cannot act on. Stalling it is the isolation, not an oversight.
 */
const stalled = new Promise<Response>(() => {});

/**
Every request except the library list, which `ImageList` issues on mount.
*/
function stubFetch(upload?: (form: FormData) => Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.includes('/user/images') && init?.method === 'POST') {
      return upload?.(init.body as FormData) ?? json(UPLOADED, 201);
    }
    if (url.includes('/user/images')) return stalled;
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the upload drop zone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('takes a dropped file and uploads it under the shared multipart field name', async () => {
    const fetchMock = stubFetch();
    render(<ConsoleView email="owner@example.com" />);
    const file = new File(['png'], 'cat.png', { type: 'image/png' });

    // A drop chooses; it does not submit. The button is the one upload path.
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    fireEvent(zone(), dragEvent('drop', { files: [file] }));
    expect(screen.getByText('cat.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(screen.getByText(/share link/i)).toBeInTheDocument());

    const [post] = posts(fetchMock);
    const form = post?.body as FormData;
    expect(form.get(UploadConstraints.fieldName)).toBe(file);
    expect(screen.getByText(/\/i\/abcdefghijklmnop/)).toBeInTheDocument();
  });

  it('stays lit while the pointer crosses the zone children, which is why it counts', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);
    const target = zone();

    fireEvent(target, dragEvent('dragenter'));
    expect(target).toHaveClass('dragging');

    // Moving onto a child fires a `dragleave` for the zone before the child's
    // `dragenter` arrives. A boolean would go dark here and flicker for the rest
    // of the drag.
    fireEvent(target, dragEvent('dragenter'));
    fireEvent(target, dragEvent('dragleave'));
    expect(target).toHaveClass('dragging');

    fireEvent(target, dragEvent('dragleave'));
    expect(target).not.toHaveClass('dragging');
  });

  it('ignores a drag that carries no file', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    fireEvent(zone(), dragEvent('dragenter', { types: ['text/plain'] }));

    expect(zone()).not.toHaveClass('dragging');
  });

  it('refuses an oversized file without a request', () => {
    const fetchMock = stubFetch();
    render(<ConsoleView email="owner@example.com" />);
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: UploadConstraints.maxBytes + 1 });

    fireEvent(zone(), dragEvent('drop', { files: [big] }));

    expect(screen.getByText(`File exceeds the ${UploadConstraints.maxBytes}-byte limit.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses a file this host will not store', () => {
    const fetchMock = stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    fireEvent(zone(), dragEvent('drop', { files: [new File(['pk'], 'archive.zip', { type: 'application/zip' })] }));

    expect(screen.getByText('Unsupported content type: application/zip')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('clears the picker after refusing a file, so the same one can be offered again', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);
    const input = screen.getByLabelText('Choose a file to upload') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(['pk'], 'archive.zip', { type: 'application/zip' })] } });

    expect(screen.getByText('Unsupported content type: application/zip')).toBeInTheDocument();
    // An input still holding the refused file does not fire `change` when that
    // same file is picked again, so the refusal could never be retried. The
    // control is replaced, and the replacement carries no files.
    const replacement = screen.getByLabelText('Choose a file to upload') as HTMLInputElement;
    expect(replacement).not.toBe(input);
    expect(replacement.files?.length ?? 0).toBe(0);
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('cancels the drag over the zone, without which no drop is delivered', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    // `dragover` is the event the browser asks "will you take this?" on. An
    // implementation that only styles the zone passes every visual check and
    // still opens the file, because the drop is never deliverable.
    const over = dragEvent('dragover') as Event & { dataTransfer: { dropEffect: string } };
    fireEvent(zone(), over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('copy');

    const textDrag = dragEvent('dragover', { types: ['text/plain'] });
    fireEvent(zone(), textDrag);
    expect(textDrag.defaultPrevented).toBe(false);
  });

  it('accepts a file whose type the browser did not declare, as the server does', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    // A drag out of some operating systems carries no type at all. Both sides
    // fall back to the extension — the same shared helper, so neither can drift.
    fireEvent(zone(), dragEvent('drop', { files: [new File(['png'], 'cat.png')] }));

    expect(screen.getByText('cat.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('refuses an empty file without a request', () => {
    const fetchMock = stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    fireEvent(zone(), dragEvent('drop', { files: [new File([], 'empty.png', { type: 'image/png' })] }));

    expect(screen.getByText('Uploaded file is empty.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('refuses the browser navigation a stray drop would cause, but only for files', () => {
    stubFetch();
    render(<ConsoleView email="owner@example.com" />);

    const over = dragEvent('dragover');
    globalThis.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    // A text drag has to reach the browser untouched: cancelling it is what would
    // stop text being dropped into the library's search box.
    const textDrag = dragEvent('dragover', { types: ['text/plain'] });
    globalThis.dispatchEvent(textDrag);
    expect(textDrag.defaultPrevented).toBe(false);
  });

  it('clears the highlight when the drop lands outside the zone', async () => {
    const fetchMock = stubFetch();
    render(<ConsoleView email="owner@example.com" />);
    fireEvent(zone(), dragEvent('dragenter'));
    expect(zone()).toHaveClass('dragging');

    await act(async () => {
      globalThis.dispatchEvent(dragEvent('drop'));
    });

    expect(zone()).not.toHaveClass('dragging');
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('ignores a file dropped while an upload is in flight', async () => {
    // The upload fails on purpose: success clears the pending selection, and with
    // it the only evidence of which file the zone is holding.
    const fetchMock = stubFetch(async () => json({ Exception: { Type: 'ServerError', Message: 'Upload failed.' } }, 500));
    render(<ConsoleView email="owner@example.com" />);

    fireEvent(zone(), dragEvent('drop', { files: [new File(['a'], 'first.png', { type: 'image/png' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();

    fireEvent(zone(), dragEvent('dragenter'));
    expect(zone()).not.toHaveClass('dragging');
    fireEvent(zone(), dragEvent('drop', { files: [new File(['b'], 'second.png', { type: 'image/png' })] }));

    await waitFor(() => expect(screen.getByText('Upload failed.')).toBeInTheDocument());
    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.queryByText('second.png')).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
  });
});
