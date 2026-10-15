import { useCallback, useEffect, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

export interface FileDropHandlers {
  onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

export interface FileDropState {
  /**
  Whether a file drag is over the zone *and* the hook would accept it.
  */
  dragging: boolean;
  handlers: FileDropHandlers;
}

export interface UseFileDropOptions {
  /**
  Called with the first file of an accepted drop. Extras are ignored.
  */
  onFile: (file: File) => void;
  /**
  `false` while an upload is in flight. A drop is then ignored, not queued.
  */
  enabled?: boolean;
}

/**
 * Whether a drag is carrying files.
 *
 * An operating-system file drag reports `['Files']`; a selected string or a link
 * reports `['text/plain']`, `['text/uri-list']` or similar. The distinction is
 * load-bearing in both directions: cancelling a *non*-file drag is what would stop
 * text being dropped into the search box, so every handler below falls through to
 * the browser's own behaviour for one.
 */
function carriesFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

/**
 * File drag and drop for one element, plus a page-wide guard against the browser
 * navigating away.
 *
 * ## Why the guard belongs to this hook
 *
 * A file dropped on a page that never cancelled the drag is a *navigation*: the
 * browser opens the file and the console — with the session view on it — is gone.
 * That is the failure this feature exists to prevent, and a zone-only
 * implementation still has it for every near-miss, so the hook owns the document
 * listener too. The guard only refuses the navigation; the zone is the only thing
 * that accepts a file.
 *
 * ## Why the highlight is a counter
 *
 * `dragleave` fires when the pointer moves onto a *child* of the zone, so a
 * boolean flickers off in the middle of a drag. `dragenter` increments and
 * `dragleave` decrements, and the zone's state changes only when the depth crosses
 * zero — which also keeps state out of `dragover`, an event that repeats roughly
 * every 100 ms for as long as the drag lasts.
 */
export function useFileDrop({ onFile, enabled = true }: UseFileDropOptions): FileDropState {
  const [depth, setDepth] = useState(0);

  const clear = useCallback(() => setDepth(0), []);

  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      // Cancelling `dragover` is what makes a drop deliverable at all;
      // cancelling `drop` is what keeps a file dropped outside the zone from
      // being opened in place of the console.
      event.preventDefault();
      if (event.type === 'drop') clear();
    };
    // Bare, not `window.`: the same object, and the lint config refuses the
    // explicit receiver as noise.
    addEventListener('dragover', guard);
    addEventListener('drop', guard);
    return () => {
      removeEventListener('dragover', guard);
      removeEventListener('drop', guard);
    };
  }, [clear]);

  const onDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDepth((current) => current + 1);
  }, []);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without this no drop event is delivered, and the browser opens the file.
    event.preventDefault();
    // A hint for the cursor: the file is being *copied into* the page, not moved.
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Clamped rather than trusted: a `dragleave` the window never saw an enter
    // for — Safari reports one with a null `relatedTarget` — would otherwise
    // leave the depth permanently above zero.
    setDepth((current) => Math.max(0, current - 1));
  }, []);

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      clear();
      // The file is dropped rather than held: the zone re-arms when the upload
      // that disabled it settles, and a queued drop would be a second upload
      // nobody asked for.
      if (!enabled) return;
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [clear, enabled, onFile],
  );

  return {
    // Derived rather than reset when `enabled` flips, so the depth stays truthful
    // across a drop that arrives while an upload is in flight.
    dragging: enabled && depth > 0,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
