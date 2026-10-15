const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
};

/**
 * Sniffs a MIME type from a filename extension.
 *
 * This is a fallback for when the stored `mime_type` is missing or when serving
 * a name we have no row for. It is never used to *validate* an upload — the
 * client-declared type decides which Telegram endpoint the bytes go to, and a
 * caller can lie about that either way.
 */
export function mimeForFileName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
The file extensions this host will store, by their leading MIME prefix.
*/
export const ACCEPTED_MIME_PREFIXES: readonly string[] = ['image/', 'video/', 'audio/', 'application/pdf'];
