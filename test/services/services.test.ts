import { describe, expect, it } from 'vitest';
import { AppConfiguration, ConfigurationManager } from '@image-host/backend-services/config';
import { sanitiseFileName } from '@image-host/backend-services/image';
import { resetJwksCacheForTests } from '@image-host/backend-services/auth';
import { escapeLike } from '@image-host/backend-data/dao/ImagesDAO';
import { presentImage } from '@image-host/backend-data/presenters/ImagePresenter';
import type { ImageRow } from '@image-host/shared/model';

const row: ImageRow = {
  id: 7,
  slug: 'AbCdEfGh12345678',
  owner_email: 'owner@example.com',
  file_id: 'telegram-file-id',
  file_name: 'holiday.png',
  mime_type: 'image/png',
  size_bytes: 1024,
  telegram_message_id: 555,
  created_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  blocked: 0,
  view_count: 12,
};

describe('AppConfiguration', () => {
  it('defaults the environment to development', () => {
    expect(ConfigurationManager.environment.get({})).toBe('development');
    expect(ConfigurationManager.environment.isProduction({})).toBe(false);
  });

  it('recognises exactly the literal string production', () => {
    // Not `prod`, not `PRODUCTION`. Several security gates key on this, so a
    // loose reading would turn a typo into a bypass.
    expect(ConfigurationManager.environment.isProduction({ ENVIRONMENT: 'production' })).toBe(true);
    expect(ConfigurationManager.environment.isProduction({ ENVIRONMENT: 'prod' })).toBe(false);
    expect(ConfigurationManager.environment.isProduction({ ENVIRONMENT: 'PRODUCTION' })).toBe(false);
  });

  it('allows the dev bypass outside production and refuses it inside', () => {
    expect(ConfigurationManager.auth.isBypassAllowed({ ENVIRONMENT: 'development' })).toBe(true);
    expect(ConfigurationManager.auth.isBypassAllowed({ ENVIRONMENT: 'production' })).toBe(false);
  });

  it('strips trailing slashes from the team domain', () => {
    // `jwtVerify` compares the token's `iss` against this string, so a trailing
    // slash would reject a correctly-issued token.
    expect(ConfigurationManager.auth.getTeamDomain({ TEAM_DOMAIN: 'https://t.example.com///' })).toBe('https://t.example.com');
  });

  it('treats a blank team domain as unset', () => {
    expect(ConfigurationManager.auth.getTeamDomain({ TEAM_DOMAIN: ' '.repeat(3) })).toBeUndefined();
  });

  it('refuses multiple audiences by name', () => {
    expect(() => ConfigurationManager.auth.getPolicyAud({ POLICY_AUD: 'a,b' })).toThrow(/single POLICY_AUD/i);
  });

  it('reads a single audience', () => {
    expect(ConfigurationManager.auth.getPolicyAud({ POLICY_AUD: '  aud-1  ' })).toBe('aud-1');
  });

  it('parses the upload limit and falls back on nonsense', () => {
    expect(ConfigurationManager.limits.getMaxUploadBytes({ MAX_UPLOAD_BYTES: '1024' }, 99)).toBe(1024);
    expect(ConfigurationManager.limits.getMaxUploadBytes({ MAX_UPLOAD_BYTES: 'lots' }, 99)).toBe(99);
    expect(ConfigurationManager.limits.getMaxUploadBytes({ MAX_UPLOAD_BYTES: '-1' }, 99)).toBe(99);
  });

  it('memoizes per env object', () => {
    const env = { ENVIRONMENT: 'staging' };
    expect(AppConfiguration.fromEnv(env)).toBe(AppConfiguration.fromEnv(env));
  });

  it('reads the demo flag as the literal string true', () => {
    expect(ConfigurationManager.auth.isDemoMode({ DEMO_MODE: 'true' })).toBe(true);
    expect(ConfigurationManager.auth.isDemoMode({ DEMO_MODE: 'TRUE' })).toBe(true);
    expect(ConfigurationManager.auth.isDemoMode({ DEMO_MODE: '1' })).toBe(false);
  });
});

describe('JWKS cache', () => {
  it('can be reset for a test that re-points the team domain', () => {
    // The cache is process-wide and keyed by domain; without this a test would
    // inherit another's memoized fetcher.
    expect(() => resetJwksCacheForTests()).not.toThrow();
  });
});

describe('sanitiseFileName', () => {
  it('takes the basename', () => {
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFileName(String.raw`C:\Users\me\photo.png`)).toBe('photo.png');
  });

  it('strips control characters', () => {
    expect(sanitiseFileName('a\u0000b\u001Fc.png')).toBe('abc.png');
  });

  it('bounds the length', () => {
    expect(sanitiseFileName(`${'a'.repeat(500)}.png`)).toHaveLength(200);
  });

  it('falls back for an empty name', () => {
    expect(sanitiseFileName('')).toBe('upload');
    expect(sanitiseFileName(' '.repeat(3))).toBe('upload');
  });

  it('keeps unicode', () => {
    expect(sanitiseFileName('照片.png')).toBe('照片.png');
  });
});

describe('escapeLike', () => {
  it('escapes the LIKE wildcards', () => {
    // Without escaping, a search for `100%` matches every row and `a_b` matches
    // `axb` — the second is worse, because a user gets a silent superset.
    expect(escapeLike('100%')).toBe(String.raw`100\%`);
    expect(escapeLike('a_b')).toBe(String.raw`a\_b`);
    expect(escapeLike(String.raw`c\d`)).toBe(String.raw`c\\d`);
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('holiday')).toBe('holiday');
  });
});

describe('presentImage', () => {
  it('maps columns to the API shape', () => {
    const view = presentImage(row, 'https://img.example.com');
    expect(view).toEqual({
      id: 7,
      slug: 'AbCdEfGh12345678',
      fileName: 'holiday.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdAt: '2026-01-01T00:00:00.000Z',
      blocked: false,
      viewCount: 12,
      url: 'https://img.example.com/i/AbCdEfGh12345678',
    });
  });

  it('presents blocked as a boolean', () => {
    expect(presentImage({ ...row, blocked: 1 }, 'https://x').blocked).toBe(true);
  });

  it('never exposes the owner or the Telegram file id', () => {
    // Exposing `file_id` would let a reader build a direct Telegram URL and
    // bypass this host's block and delete state entirely.
    const serialised = JSON.stringify(presentImage(row, 'https://x'));
    expect(serialised).not.toContain('owner@example.com');
    expect(serialised).not.toContain('telegram-file-id');
  });
});
