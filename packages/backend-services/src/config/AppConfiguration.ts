/**
 * Consumer configuration, read once per call and memoized per `env` object.
 *
 * The `WeakMap` matters more than it looks: `wrangler` hands the same `env` to
 * every request in an isolate, so caching on object identity gives one parse per
 * deployment rather than one per request. A `Map` keyed by a spread copy of
 * `env` would parse on every call and still miss whenever a binding object
 * changed identity.
 */
export interface ImageHostEnv {
  ENVIRONMENT?: string;
  DEMO_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  MAX_UPLOAD_BYTES?: string;
  LOG_LEVEL?: string;
}

export class AppConfiguration {
  private static readonly cache = new WeakMap<object, AppConfiguration>();

  private constructor(private readonly env: ImageHostEnv) {}

  public static fromEnv(env: unknown): AppConfiguration {
    const key = typeof env === 'object' && env !== null ? env : {};
    let configuration = AppConfiguration.cache.get(key);
    if (!configuration) {
      configuration = new AppConfiguration(env as ImageHostEnv);
      AppConfiguration.cache.set(key, configuration);
    }
    return configuration;
  }

  public getEnvironment(): string {
    return this.trimmed(this.env.ENVIRONMENT) ?? 'development';
  }

  /**
   * `production` is the literal string.
   *
   * Not `prod`, not "anything that isn't development", not "unset". Several
   * security gates below refuse to authenticate under this predicate, and a
   * loose reading would turn a typo into a bypass — so an unrecognised value is
   * treated as *not* production by `isProduction` but is visible in
   * `getEnvironment`, and the dev-auth guard logs loudly either way.
   */
  public isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }

  public isDemoMode(): boolean {
    return this.flag(this.env.DEMO_MODE);
  }

  /**
   * Whether the local-only authentication bypass may be honoured.
   *
   * This is the predicate `DEV_AUTH_EMAIL` is gated on, and it is
   * environment-only on purpose: gating it on "is the var set" instead would make
   * a `.dev.vars` file promoted into a deployment authenticate every caller as
   * one address. Reading it before verifying anything is deliberate — the bypass
   * is the one path that does not need a token to be present.
   */
  public isBypassAllowed(): boolean {
    return !this.isProduction();
  }

  public getDevAuthEmail(): string | undefined {
    return this.trimmed(this.env.DEV_AUTH_EMAIL);
  }

  public getTeamDomain(): string | undefined {
    const value = this.trimmed(this.env.TEAM_DOMAIN);
    if (!value) return undefined;
    // Trailing slashes are stripped rather than normalised: `jwtVerify` compares
    // the token's `iss` against this string, and a trailing slash would make a
    // correctly-issued token fail verification with an error that reads as a
    // configuration bug at the wrong layer.
    // The index loop rather than `replace(/\/+$/, '')`: the quantified group
    // backtracks on a non-match, and a 20-character `TEAM_DOMAIN` is not worth a
    // lint rule about a regex nobody writes by hand.
    let end = value.length;
    while (end > 0 && value.charAt(end - 1) === '/') end -= 1;
    return value.slice(0, end);
  }

  public getPolicyAud(): string | undefined {
    const value = this.trimmed(this.env.POLICY_AUD);
    if (!value) return undefined;
    if (value.includes(',')) {
      // A single-issuer application has exactly one audience. A comma here is a
      // misconfiguration, and passing it to `jwtVerify` as one string produces a
      // mismatch error that names the whole list — so it is refused by name.
      throw new Error('Multiple JWT audiences are not supported. Configure a single POLICY_AUD value.');
    }
    return value;
  }

  public getMaxUploadBytes(fallback: number): number {
    const parsed = Number(this.env.MAX_UPLOAD_BYTES);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private flag(value: string | undefined): boolean {
    return (value ?? '').trim().toLowerCase() === 'true';
  }

  private trimmed(value: string | undefined): string | undefined {
    const next = (value ?? '').trim();
    return next.length > 0 ? next : undefined;
  }
}

/**
Statics kept for call sites that have not been migrated to injecting `AppConfiguration`.
*/
export const ConfigurationManager = {
  auth: {
    isDemoMode: (env: unknown): boolean => AppConfiguration.fromEnv(env).isDemoMode(),
    isBypassAllowed: (env: unknown): boolean => AppConfiguration.fromEnv(env).isBypassAllowed(),
    getDevAuthEmail: (env: unknown): string | undefined => AppConfiguration.fromEnv(env).getDevAuthEmail(),
    getTeamDomain: (env: unknown): string | undefined => AppConfiguration.fromEnv(env).getTeamDomain(),
    getPolicyAud: (env: unknown): string | undefined => AppConfiguration.fromEnv(env).getPolicyAud(),
  },
  environment: {
    get: (env: unknown): string => AppConfiguration.fromEnv(env).getEnvironment(),
    isProduction: (env: unknown): boolean => AppConfiguration.fromEnv(env).isProduction(),
  },
  limits: {
    getMaxUploadBytes: (env: unknown, fallback: number): number => AppConfiguration.fromEnv(env).getMaxUploadBytes(fallback),
  },
};
