const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a share-link slug.
 *
 * The alphabet is 62 characters and the default length is 16, which is ~95 bits
 * of entropy — the slug is the only thing standing between a public URL and
 * somebody else's image, so it is generated from `crypto.getRandomValues` rather
 * than `Math.random`.
 *
 * The modulo bias below is at most `256/62` — about 3% — which is irrelevant at
 * 95 bits, and rejecting draws instead would need a loop whose cost is harder to
 * reason about than the bias it removes.
 */
export function makeSlug(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let index = 0; index < length; index++) {
    out += SLUG_ALPHABET[bytes[index] % SLUG_ALPHABET.length];
  }
  return out;
}

/**
The slug alphabet, exported so a test can assert a generated slug is reachable.
*/
export const SLUG_CHARACTER_SET = SLUG_ALPHABET;
