import { log } from '@image-host/shared';
import type { Env } from '../types';

function b64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseJwt(token: string): { header: any; payload: any; signingInput: string; signature: Uint8Array } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1])));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: b64UrlDecode(parts[2]) };
  } catch {
    return null;
  }
}

export async function verifyZeroTrustToken(token: string, env: Env): Promise<string | null> {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  const { header, payload } = parsed;

  if (!payload || typeof payload.email !== 'string') return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (env.POLICY_AUD && !auds.includes(env.POLICY_AUD)) return null;

  if (env.DEV_AUTH_EMAIL && env.ENVIRONMENT !== 'production') return env.DEV_AUTH_EMAIL;

  if (!env.TEAM_DOMAIN) return null;
  const teamDomain = env.TEAM_DOMAIN.replace(/\/$/, '');
  let jwks: any;
  try {
    const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
    jwks = await res.json();
  } catch (error) {
    log.error('Failed to fetch Access certs', { error });
    return null;
  }
  const key = Array.isArray(jwks?.keys) ? jwks.keys.find((k: any) => k.kid === header.kid) : null;
  if (!key) return null;

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(parsed.signingInput);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, parsed.signature as BufferSource, data as BufferSource);
    if (!ok) return null;
  } catch (error) {
    log.error('JWT verification failed', { error });
    return null;
  }

  return payload.email as string;
}

export async function getZeroTrustEmail(request: Request, env: Env): Promise<string | null> {
  if (env.DEV_AUTH_EMAIL && env.ENVIRONMENT !== 'production') return env.DEV_AUTH_EMAIL;

  const headerToken = request.headers.get('cf-access-jwt-assertion');
  const cookieHeader = request.headers.get('cookie') || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
  const token = headerToken || cookieToken;
  if (!token) return null;
  return verifyZeroTrustToken(token, env);
}

export function unauthorizedResponse(): Response {
  return Response.json({ success: false, message: 'Authentication required' }, { status: 401 });
}