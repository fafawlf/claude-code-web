import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';
import { UserRegistry } from '../users/registry.js';
import { signSession } from '../auth/cookie.js';
import type { CcwConfig } from '../config.js';

const SECRET = 'test-cookie-secret-test-cookie-secret';
const TOKEN = 'legacy-token';

type Setup = {
  app: FastifyInstance;
  sm: SessionManager;
  dataDir: string;
  usersRoot: string;
  aliceRoot: string;
  bobRoot: string;
  cookies: { alice: string; bob: string; boss: string };
  cleanup: () => Promise<void>;
};

async function setup(): Promise<Setup> {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-scope-'));
  const usersRoot = join(dataDir, 'users');
  const config: CcwConfig = {
    authMode: 'feishu',
    cookieSecret: SECRET,
    cookieSecure: false,
    adminEmails: ['boss@x.com'],
    feishu: { appId: 'app', appSecret: 'secret' },
    dataDir,
    usersRoot,
    usersFile: join(dataDir, 'users.json'),
    templateDir: join(dataDir, 'template'),
    publicOrigin: 'https://claude.example.com',
  };
  const registry = new UserRegistry(config.usersFile, config.adminEmails);
  registry.addToAllowlist('alice@x.com');
  registry.addToAllowlist('bob@x.com');
  registry.upsertOnLogin({ openId: 'ou_alice', email: 'alice@x.com', name: 'Alice' });
  registry.upsertOnLogin({ openId: 'ou_bob', email: 'bob@x.com', name: 'Bob' });
  registry.upsertOnLogin({ openId: 'ou_boss', email: 'boss@x.com', name: 'Boss' });

  const aliceRoot = join(usersRoot, 'alice');
  const bobRoot = join(usersRoot, 'bob');
  mkdirSync(aliceRoot, { recursive: true });
  mkdirSync(bobRoot, { recursive: true });
  writeFileSync(join(aliceRoot, 'mine.md'), '# alice notes\n');
  writeFileSync(join(bobRoot, 'secret.md'), '# bob secrets\n');

  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, TOKEN, dataDir, sm, undefined, {}, { config, registry });

  const now = Math.floor(Date.now() / 1000);
  const cookieFor = (sub: string) => `ccw_session=${encodeURIComponent(signSession({ sub, iat: now, exp: now + 3600 }, SECRET))}`;

  return {
    app,
    sm,
    dataDir,
    usersRoot,
    aliceRoot,
    bobRoot,
    cookies: { alice: cookieFor('ou_alice'), bob: cookieFor('ou_bob'), boss: cookieFor('ou_boss') },
    cleanup: async () => {
      await app.close();
      await sm.closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('unauthenticated /api requests are rejected in feishu mode', async () => {
  const s = await setup();
  try {
    const res = await s.app.inject({ method: 'GET', url: '/api/info' });
    assert.equal(res.statusCode, 401);
    const bad = await s.app.inject({ method: 'GET', url: '/api/info', headers: { cookie: 'ccw_session=forged.value' } });
    assert.equal(bad.statusCode, 401);
  } finally {
    await s.cleanup();
  }
});

test('only admins can authorize a canary routing cookie', async () => {
  const s = await setup();
  try {
    const anonymous = await s.app.inject({ method: 'GET', url: '/api/admin/canary-check' });
    assert.equal(anonymous.statusCode, 401);

    const member = await s.app.inject({
      method: 'GET',
      url: '/api/admin/canary-check',
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(member.statusCode, 403);

    const admin = await s.app.inject({
      method: 'GET',
      url: '/api/admin/canary-check',
      headers: { cookie: s.cookies.boss },
    });
    assert.equal(admin.statusCode, 204);
  } finally {
    await s.cleanup();
  }
});

test('directory browsing is confined to the user workspace', async () => {
  const s = await setup();
  try {
    const own = await s.app.inject({ method: 'GET', url: '/api/dirs', headers: { cookie: s.cookies.alice } });
    assert.equal(own.statusCode, 200);
    const ownBody = JSON.parse(own.body) as { path: string; parent: string | null };
    assert.equal(ownBody.path, s.aliceRoot);
    assert.equal(ownBody.parent, null); // cannot navigate above the workspace

    const cross = await s.app.inject({
      method: 'GET',
      url: `/api/dirs?path=${encodeURIComponent(s.bobRoot)}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(cross.statusCode, 403);

    const up = await s.app.inject({
      method: 'GET',
      url: `/api/dirs?path=${encodeURIComponent(join(s.aliceRoot, '..'))}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(up.statusCode, 403);

    const mkdirCross = await s.app.inject({
      method: 'POST',
      url: '/api/dirs',
      headers: { cookie: s.cookies.alice },
      payload: { parentPath: s.bobRoot, name: 'intruder' },
    });
    assert.equal(mkdirCross.statusCode, 403);
  } finally {
    await s.cleanup();
  }
});

test('file reads cannot escape the workspace — including credential files', async () => {
  const s = await setup();
  try {
    const own = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.aliceRoot)}&path=mine.md`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(own.statusCode, 200);
    assert.match(own.body, /alice notes/);

    // The exact attack that used to leak the shared Max subscription token.
    const creds = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.aliceRoot)}&path=${encodeURIComponent('/root/.claude/.credentials.json')}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(creds.statusCode, 403);

    const crossAbs = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.aliceRoot)}&path=${encodeURIComponent(join(s.bobRoot, 'secret.md'))}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(crossAbs.statusCode, 403);

    const crossRel = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.aliceRoot)}&path=${encodeURIComponent('../bob/secret.md')}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.notEqual(crossRel.statusCode, 200);

    const crossCwd = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.bobRoot)}&path=secret.md`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(crossCwd.statusCode, 403);
  } finally {
    await s.cleanup();
  }
});

test('uploads, file search and session listings are workspace-scoped', async () => {
  const s = await setup();
  try {
    const upload = await s.app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie: s.cookies.alice },
      payload: { cwd: s.bobRoot, files: [{ name: 'x.txt', dataBase64: Buffer.from('hi').toString('base64') }] },
    });
    assert.equal(upload.statusCode, 403);

    const search = await s.app.inject({
      method: 'GET',
      url: `/api/files?cwd=${encodeURIComponent(s.bobRoot)}&q=secret`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(search.statusCode, 403);

    const sessions = await s.app.inject({
      method: 'GET',
      url: `/api/sessions?cwd=${encodeURIComponent(s.bobRoot)}`,
      headers: { cookie: s.cookies.alice },
    });
    assert.equal(sessions.statusCode, 403);
  } finally {
    await s.cleanup();
  }
});

test('live sessions are filtered by owner and protected from cross-user close', async () => {
  const s = await setup();
  try {
    const aliceSession = s.sm.create({ cwd: s.aliceRoot, owner: 'ou_alice' });
    s.sm.create({ cwd: s.bobRoot, owner: 'ou_bob' });

    const list = await s.app.inject({ method: 'GET', url: '/api/live-sessions', headers: { cookie: s.cookies.alice } });
    const body = JSON.parse(list.body) as { sessions: Array<{ sessionId: string }> };
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].sessionId, aliceSession.id);

    const adminList = await s.app.inject({ method: 'GET', url: '/api/live-sessions', headers: { cookie: s.cookies.boss } });
    assert.equal((JSON.parse(adminList.body) as { sessions: unknown[] }).sessions.length, 2);

    const close = await s.app.inject({
      method: 'POST',
      url: '/api/session/close',
      headers: { cookie: s.cookies.bob },
      payload: { sessionId: aliceSession.id },
    });
    assert.equal(close.statusCode, 403);
    assert.ok(s.sm.get(aliceSession.id));
  } finally {
    await s.cleanup();
  }
});

test('server internals are hidden from members but kept for legacy token auth', async () => {
  const s = await setup();
  try {
    const member = await s.app.inject({ method: 'GET', url: '/api/info', headers: { cookie: s.cookies.alice } });
    const memberInfo = JSON.parse(member.body) as { cwd: string; home: string; server?: { host?: string; port?: number }; claude?: { path?: string } };
    assert.equal(memberInfo.cwd, s.aliceRoot);
    assert.equal(memberInfo.home, s.aliceRoot);
    assert.equal(memberInfo.server?.host, undefined);
    assert.equal(memberInfo.claude?.path, undefined);

    const token = await s.app.inject({ method: 'GET', url: `/api/info?t=${TOKEN}` });
    const tokenInfo = JSON.parse(token.body) as { cwd: string; server?: { host?: string } };
    assert.equal(tokenInfo.cwd, s.dataDir);
    assert.equal(tokenInfo.server?.host, '127.0.0.1');

    const nodes = await s.app.inject({ method: 'GET', url: '/api/nodes', headers: { cookie: s.cookies.alice } });
    const nodeList = JSON.parse(nodes.body) as { nodes: Array<{ defaultCwd: string }> };
    assert.equal(nodeList.nodes[0].defaultCwd, s.aliceRoot);

    const me = await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s.cookies.alice } });
    const meBody = JSON.parse(me.body) as { authMode: string; user: { slug: string; role: string } };
    assert.equal(meBody.authMode, 'feishu');
    assert.equal(meBody.user.slug, 'alice');
    assert.equal(meBody.user.role, 'user');
  } finally {
    await s.cleanup();
  }
});

test('admins are scoped to the data dir, not the whole filesystem', async () => {
  const s = await setup();
  try {
    const users = await s.app.inject({
      method: 'GET',
      url: `/api/dirs?path=${encodeURIComponent(s.usersRoot)}`,
      headers: { cookie: s.cookies.boss },
    });
    assert.equal(users.statusCode, 200);

    const outside = await s.app.inject({
      method: 'GET',
      url: `/api/dirs?path=${encodeURIComponent('/etc')}`,
      headers: { cookie: s.cookies.boss },
    });
    assert.equal(outside.statusCode, 403);

    const creds = await s.app.inject({
      method: 'GET',
      url: `/api/file?cwd=${encodeURIComponent(s.dataDir)}&path=${encodeURIComponent('/root/.claude/.credentials.json')}`,
      headers: { cookie: s.cookies.boss },
    });
    assert.equal(creds.statusCode, 403);
  } finally {
    await s.cleanup();
  }
});

test('legacy token keeps full single-user behavior', async () => {
  const s = await setup();
  try {
    const dirs = await s.app.inject({ method: 'GET', url: `/api/dirs?t=${TOKEN}&path=${encodeURIComponent(s.bobRoot)}` });
    assert.equal(dirs.statusCode, 200);
    const file = await s.app.inject({
      method: 'GET',
      url: `/api/file?t=${TOKEN}&cwd=${encodeURIComponent(s.bobRoot)}&path=secret.md`,
    });
    assert.equal(file.statusCode, 200);
  } finally {
    await s.cleanup();
  }
});
