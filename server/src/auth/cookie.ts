import { createHmac } from 'node:crypto';
import { timingSafeEqualStr } from '../auth.js';

export const SESSION_COOKIE = 'ccw_session';
export const STATE_COOKIE = 'ccw_oauth_state';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = {
  /** Feishu open_id of the logged-in user. */
  sub: string;
  iat: number;
  exp: number;
};

export function signSession(payload: SessionPayload, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${mac(body, secret)}`;
}

export function verifySession(value: string | undefined, secret: string): SessionPayload | null {
  if (!value || !secret) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!timingSafeEqualStr(mac(body, secret), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean; path?: string } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, opts: { secure?: boolean } = {}): string {
  return serializeCookie(name, '', { maxAge: 0, secure: opts.secure });
}

function mac(body: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(body).digest());
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}
