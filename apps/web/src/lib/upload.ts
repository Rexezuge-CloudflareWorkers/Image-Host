import { ACCEPTED_MIME_PREFIXES, mimeForFileName } from '@image-host/shared/utils';
import { UploadConstraints } from '@image-host/shared/schema';

/**
 * The `accept` filter for the file input.
 *
 * Derived from the same list `ImageService.upload` checks a declared type
 * against, so the picker stops offering what the API would answer with a 415.
 * The list holds both wildcards (`image/`) and whole types (`application/pdf`),
 * which is why the star is appended rather than assumed.
 */
export const UPLOAD_ACCEPT = ACCEPTED_MIME_PREFIXES.map((prefix) => (prefix.endsWith('/') ? `${prefix}*` : prefix)).join(',');

/**
 * Why an upload would be refused, or `null` when the file is acceptable.
 *
 * This is a *pre*-check, not the validation. `ImageService.upload` stays
 * authoritative, and the two are not interchangeable:
 *
 * - The size ceiling here is `UploadConstraints.maxBytes`, the shared constant
 *   that mirrors Telegram's `getFile` limit — anything above it can be uploaded
 *   but never served, so a file it admits can still be refused by a deployment
 *   that configured `MAX_UPLOAD_BYTES` lower. That direction is the only safe one:
 *   the alternative, trusting a deployment's tighter limit on the client, needs
 *   the console to know a number it cannot see.
 * - The type check runs the server's own expression (`file.type` falling back to
 *   the filename's extension) against the server's own list, so the two agree by
 *   construction rather than by habit.
 *
 * The checks and their order mirror `ImageService.upload` so a file that fails
 * two of them is named the same way in either place.
 */
export function describeUploadProblem(file: File): string | null {
  const declaredType = file.type || mimeForFileName(file.name);
  if (ACCEPTED_MIME_PREFIXES.every((prefix) => !declaredType.startsWith(prefix))) {
    return `Unsupported content type: ${declaredType}`;
  }
  if (file.size > UploadConstraints.maxBytes) {
    return `File exceeds the ${UploadConstraints.maxBytes}-byte limit.`;
  }
  if (file.size === 0) {
    return 'Uploaded file is empty.';
  }
  return null;
}
