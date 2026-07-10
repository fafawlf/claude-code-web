import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerApi } from '../api.js';
import { signSession } from '../auth/cookie.js';
import type { CcwConfig } from '../config.js';
import { SessionManager } from '../session/SessionManager.js';
import { ensureSafeUploadDirectory, UploadAdmissionController } from '../uploadSecurity.js';
import { UserRegistry } from '../users/registry.js';

test('[QA] upload admission keeps only two requests active for one user and cwd', async () => {
  const gate = new UploadAdmissionController({ maxFiles: 12, maxBytes: 50, concurrency: 2 });
  const request = { userKey: 'alice', cwd: '/project' };
  const first = await gate.acquire({ ...request, selectionId: 'one' });
  const second = await gate.acquire({ ...request, selectionId: 'two' });
  let thirdEntered = false;
  const thirdPromise = gate.acquire({ ...request, selectionId: 'three' }).then((lease) => {
    thirdEntered = true;
    return lease;
  });

  await nextTurn();
  assert.equal(thirdEntered, false);
  first.release();
  const third = await thirdPromise;
  assert.equal(thirdEntered, true);
  second.release();
  third.release();
});

test('[QA] concurrent one-file requests cannot bypass the rolling byte quota with new selection ids', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-rolling-bytes-'));
  const gate = new UploadAdmissionController({ maxFiles: 12, maxBytes: 10, concurrency: 2 });
  const { app, sm } = setupTokenApp(root, gate);

  try {
    const results = await Promise.all(['a', 'b', 'c'].map((name) => multipartRequest(app, root, name, Buffer.alloc(6), name)));
    assert.equal(results.filter((result) => result.statusCode === 200).length, 1, results.map((r) => r.body).join('\n'));
    assert.equal(results.filter((result) => result.statusCode === 400).length, 2);
    assert.ok(countFiles(join(root, '.claudecode-web', 'uploads')) <= 1);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('[QA] concurrent one-file requests cannot bypass the rolling file-count quota', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-rolling-count-'));
  const gate = new UploadAdmissionController({ maxFiles: 2, maxBytes: 100, concurrency: 2 });
  const { app, sm } = setupTokenApp(root, gate);

  try {
    const results = await Promise.all(['a', 'b', 'c'].map((name) => multipartRequest(app, root, name, Buffer.from(name), name)));
    assert.equal(results.filter((result) => result.statusCode === 200).length, 2, results.map((r) => r.body).join('\n'));
    assert.equal(results.filter((result) => result.statusCode === 400).length, 1);
    assert.equal(countFiles(join(root, '.claudecode-web', 'uploads')), 2);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const linkedComponent of ['.claudecode-web', 'uploads'] as const) {
  test(`[QA] upload fails closed when ${linkedComponent} is a symbolic link`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'ccw-upload-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'ccw-upload-outside-'));
    if (linkedComponent === 'uploads') mkdirSync(join(root, '.claudecode-web'));
    symlinkSync(outside, join(root, linkedComponent === '.claudecode-web' ? linkedComponent : '.claudecode-web/uploads'));
    const { app, sm } = setupTokenApp(root);

    try {
      const result = await multipartRequest(app, root, 'escape', Buffer.from('secret'), 'escape');
      assert.equal(result.statusCode, 400, result.body);
      assert.match(result.body, /symbolic links/);
      assert.equal(readdirSync(outside).length, 0);
    } finally {
      await app.close();
      await sm.closeAll();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('[QA] upload rejects a symbolic-link component between the workspace root and cwd', async () => {
  const scope = mkdtempSync(join(tmpdir(), 'ccw-upload-scope-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'ccw-upload-scope-outside-'));
  mkdirSync(join(outside, 'project'));
  symlinkSync(outside, join(scope, 'linked'));

  try {
    await assert.rejects(
      ensureSafeUploadDirectory(join(scope, 'linked', 'project'), '2026-07-10', scope),
      /symbolic links/,
    );
    assert.equal(readdirSync(join(outside, 'project')).length, 0);
  } finally {
    rmSync(scope, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('[QA] Feishu cookie auth rejects legacy Base64 JSON before the upload handler', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-upload-json-disabled-'));
  const usersRoot = join(dataDir, 'users');
  const aliceRoot = join(usersRoot, 'alice');
  const secret = 'test-cookie-secret-test-cookie-secret';
  const config: CcwConfig = {
    authMode: 'feishu',
    cookieSecret: secret,
    cookieSecure: false,
    adminEmails: [],
    allowedEmailDomains: [],
    trustAllFeishu: false,
    feishu: { appId: 'app', appSecret: 'secret' },
    dataDir,
    usersRoot,
    usersFile: join(dataDir, 'users.json'),
    templateDir: join(dataDir, 'template'),
    publicOrigin: 'https://claude.example.com',
  };
  const registry = new UserRegistry(config.usersFile, config.adminEmails);
  registry.addToAllowlist('alice@x.com');
  registry.upsertOnLogin({ openId: 'ou_alice', email: 'alice@x.com', name: 'Alice' });
  mkdirSync(aliceRoot, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const cookie = `ccw_session=${encodeURIComponent(signSession({ sub: 'ou_alice', iat: now, exp: now + 3600 }, secret))}`;
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'legacy-token', dataDir, sm, undefined, {}, { config, registry });

  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie },
      payload: {
        cwd: aliceRoot,
        files: [{ name: 'legacy.txt', dataBase64: Buffer.from('legacy').toString('base64') }],
      },
    });
    assert.equal(result.statusCode, 415, result.body);
    assert.match(result.body, /multipart\/form-data/);
    assert.equal(countFiles(join(aliceRoot, '.claudecode-web', 'uploads')), 0);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function setupTokenApp(root: string, uploadAdmission?: UploadAdmissionController) {
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm, undefined, { uploadAdmission });
  return { app, sm };
}

function multipartRequest(
  app: ReturnType<typeof Fastify>,
  root: string,
  name: string,
  bytes: Buffer,
  selectionId: string,
) {
  const boundary = `----ccw-security-${name}`;
  return app.inject({
    method: 'POST',
    url: `/api/uploads?t=tok&cwd=${encodeURIComponent(root)}&sessionKey=chat&selectionId=${encodeURIComponent(selectionId)}`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="files"; filename="${name}.bin"\r\n`
        + 'Content-Type: application/octet-stream\r\n\r\n',
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

function countFiles(path: string): number {
  try {
    return readdirSync(path, { withFileTypes: true }).reduce(
      (count, entry) => count + (entry.isDirectory() ? countFiles(join(path, entry.name)) : 1),
      0,
    );
  } catch {
    return 0;
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}
