import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieHeader, serializeCookie, signSession, verifySession } from '../auth/cookie.js';

const SECRET = 's'.repeat(48);

test('signSession/verifySession round-trips a payload', () => {
  const now = Math.floor(Date.now() / 1000);
  const value = signSession({ sub: 'ou_abc123', iat: now, exp: now + 3600 }, SECRET);
  const payload = verifySession(value, SECRET);
  assert.ok(payload);
  assert.equal(payload!.sub, 'ou_abc123');
});

test('verifySession rejects tampered payloads and signatures', () => {
  const now = Math.floor(Date.now() / 1000);
  const value = signSession({ sub: 'ou_abc123', iat: now, exp: now + 3600 }, SECRET);
  const [body, sig] = value.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'ou_evil', iat: now, exp: now + 3600 }), 'utf8').toString('base64url');
  assert.equal(verifySession(`${forgedBody}.${sig}`, SECRET), null);
  assert.equal(verifySession(`${body}.${sig.slice(0, -2)}xx`, SECRET), null);
  assert.equal(verifySession(value, 'different-secret-different-secret'), null);
  assert.equal(verifySession(undefined, SECRET), null);
  assert.equal(verifySession('garbage', SECRET), null);
});

test('verifySession rejects expired sessions', () => {
  const now = Math.floor(Date.now() / 1000);
  const value = signSession({ sub: 'ou_abc123', iat: now - 7200, exp: now - 3600 }, SECRET);
  assert.equal(verifySession(value, SECRET), null);
});

test('parseCookieHeader parses multiple cookies and keeps the first duplicate', () => {
  const cookies = parseCookieHeader('a=1; ccw_session=abc.def; a=2; empty=');
  assert.equal(cookies.a, '1');
  assert.equal(cookies.ccw_session, 'abc.def');
  assert.equal(parseCookieHeader(undefined).ccw_session, undefined);
});

test('serializeCookie emits hardened attributes', () => {
  const cookie = serializeCookie('ccw_session', 'v', { maxAge: 60 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=60/);
  const insecure = serializeCookie('ccw_session', 'v', { maxAge: 60, secure: false });
  assert.doesNotMatch(insecure, /Secure/);
});
