import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { timingSafeEqualStr } from '../auth.js';
import type { CcwConfig } from '../config.js';
import type { UserRegistry } from '../users/registry.js';
import { provisionWorkspace } from '../users/provision.js';
import { FeishuClient } from './feishu.js';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SECONDS,
  clearCookie,
  parseCookieHeader,
  serializeCookie,
  signSession,
} from './cookie.js';

export type AuthContext = {
  config: CcwConfig;
  registry: UserRegistry;
  feishu: FeishuClient;
};

/**
 * Login routes for feishu mode. Registered before the /api auth gate; these
 * endpoints are reachable without a session on purpose.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AuthContext): void {
  const { config, registry, feishu } = ctx;
  const redirectUri = `${config.publicOrigin}/auth/callback`;

  app.get('/login', async (_req, reply) => {
    const state = randomBytes(16).toString('hex');
    reply.header(
      'set-cookie',
      serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure: config.cookieSecure })
    );
    return reply.redirect(feishu.authorizeUrl(redirectUri, state));
  });

  app.get('/auth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string } | undefined;
    const cookies = parseCookieHeader(req.headers.cookie);
    const expectedState = cookies[STATE_COOKIE] ?? '';
    if (!q?.code) return failPage(reply, 400, 'Missing authorization code.');
    if (!q.state || !expectedState || !timingSafeEqualStr(q.state, expectedState)) {
      return failPage(reply, 400, 'Login state mismatch. Please try logging in again.');
    }

    let info;
    try {
      const userToken = await feishu.exchangeCode(q.code);
      info = await feishu.getUserInfo(userToken);
    } catch (e) {
      req.log.error({ err: e }, 'feishu oauth failed');
      return failPage(reply, 502, 'Feishu login failed. Please try again.');
    }

    if (!registry.isAllowed({ email: info.email, openId: info.openId })) {
      req.log.warn({ email: info.email, openId: info.openId }, 'login rejected: not allowlisted');
      return failPage(
        reply,
        403,
        `This Feishu account (${info.email || info.openId}) is not authorized yet. Ask the workspace admin to add you.`,
        true
      );
    }

    const user = registry.upsertOnLogin(info);
    try {
      await provisionWorkspace(`${config.usersRoot}/${user.slug}`, config.templateDir);
    } catch (e) {
      req.log.error({ err: e, slug: user.slug }, 'workspace provisioning failed');
      return failPage(reply, 500, 'Could not prepare your workspace. Contact the admin.');
    }

    const now = Math.floor(Date.now() / 1000);
    const session = signSession(
      { sub: user.openId, iat: now, exp: now + SESSION_TTL_SECONDS },
      config.cookieSecret
    );
    reply.header('set-cookie', [
      serializeCookie(SESSION_COOKIE, session, {
        maxAge: SESSION_TTL_SECONDS,
        secure: config.cookieSecure,
      }),
      clearCookie(STATE_COOKIE, { secure: config.cookieSecure }),
    ]);
    return reply.redirect('/');
  });

  app.post('/logout', async (_req, reply) => {
    reply.header('set-cookie', clearCookie(SESSION_COOKIE, { secure: config.cookieSecure }));
    return { ok: true };
  });
}

function failPage(reply: FastifyReply, code: number, message: string, withLogin = false): FastifyReply {
  const retry = withLogin
    ? '<p><a href="/login">Try a different account</a></p>'
    : '<p><a href="/login">Back to login</a></p>';
  return reply
    .code(code)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;background:#111;color:#eee">` +
        `<div style="max-width:28rem;text-align:center"><h2>Claude Code Web</h2><p>${escapeHtml(message)}</p>${retry}</div></body>`
    );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
