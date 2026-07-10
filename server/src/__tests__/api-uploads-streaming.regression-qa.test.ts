import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';
import { UserRegistry } from '../users/registry.js';
import { signSession } from '../auth/cookie.js';
import type { CcwConfig } from '../config.js';

// QA regression: multipart uploads must preserve binary bytes without a Base64 JSON copy.
test('[QA] POST /api/uploads streams multipart files into the scoped project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-stream-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);
  const boundary = '----ccw-qa-stream-boundary';
  const bytes = Buffer.from([0, 1, 2, 3, 254, 255]);

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads?t=tok&cwd=${encodeURIComponent(root)}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [{ field: 'files', name: '../pixel?.bin', mime: 'application/octet-stream', bytes }]),
    });

    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body) as {
      files: Array<{ name: string; path: string; relativePath: string; mime?: string; size: number }>;
    };
    assert.equal(body.files.length, 1);
    assert.equal(body.files[0].name, 'pixel-.bin');
    assert.equal(body.files[0].mime, 'application/octet-stream');
    assert.equal(body.files[0].size, bytes.byteLength);
    assert.deepEqual(readFileSync(body.files[0].path), bytes);
    assert.match(body.files[0].relativePath, /^\.claudecode-web\/uploads\/\d{4}-\d{2}-\d{2}\/pixel-\.bin$/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// QA regression: streaming must not turn the documented per-file cap into an in-memory overrun.
test('[QA] multipart uploads reject a file larger than 25 MiB and remove the partial file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-stream-limit-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);
  const boundary = '----ccw-qa-file-limit';

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads?t=tok&cwd=${encodeURIComponent(root)}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [{
        field: 'files',
        name: 'too-large.bin',
        mime: 'application/octet-stream',
        bytes: Buffer.alloc(25 * 1024 * 1024 + 1, 7),
      }]),
    });

    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /larger than 25 MB/);
    const uploadRoot = join(root, '.claudecode-web', 'uploads');
    assert.equal(countFiles(uploadRoot), 0);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// QA regression: many individually-valid files must still obey the explicit request cap.
test('[QA] multipart uploads enforce the 50 MiB total cap atomically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-stream-total-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);
  const boundary = '----ccw-qa-total-limit';

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads?t=tok&cwd=${encodeURIComponent(root)}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [
        { field: 'files', name: 'a.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(25 * 1024 * 1024, 1) },
        { field: 'files', name: 'b.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(25 * 1024 * 1024, 2) },
        { field: 'files', name: 'c.bin', mime: 'application/octet-stream', bytes: Buffer.from([3]) },
      ]),
    });

    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /50 MB total limit/);
    assert.equal(countFiles(join(root, '.claudecode-web', 'uploads')), 0);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// QA regression: a multipart client cannot bypass the 12-file batch limit.
test('[QA] multipart uploads reject a thirteenth file and remove the batch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-stream-count-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);
  const boundary = '----ccw-qa-file-count';

  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/uploads?t=tok&cwd=${encodeURIComponent(root)}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, Array.from({ length: 13 }, (_, index) => ({
        field: 'files',
        name: `${index + 1}.txt`,
        mime: 'text/plain',
        bytes: Buffer.from(String(index + 1)),
      }))),
    });

    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /at most 12 files/);
    assert.equal(countFiles(join(root, '.claudecode-web', 'uploads')), 0);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

// QA regression: the streaming path must use the same Feishu identity and workspace scope as JSON uploads.
test('[QA] multipart uploads keep Feishu cookie auth workspace-scoped', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-upload-stream-scope-'));
  const usersRoot = join(dataDir, 'users');
  const aliceRoot = join(usersRoot, 'alice');
  const bobRoot = join(usersRoot, 'bob');
  const secret = 'test-cookie-secret-test-cookie-secret';
  const config: CcwConfig = {
    authMode: 'feishu',
    cookieSecret: secret,
    cookieSecure: false,
    adminEmails: ['boss@x.com'],
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
  mkdirSync(bobRoot, { recursive: true });

  const now = Math.floor(Date.now() / 1000);
  const cookie = `ccw_session=${encodeURIComponent(signSession({ sub: 'ou_alice', iat: now, exp: now + 3600 }, secret))}`;
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'legacy-token', dataDir, sm, undefined, {}, { config, registry });
  const boundary = '----ccw-qa-cookie-scope';

  try {
    const own = await app.inject({
      method: 'POST',
      url: `/api/uploads?cwd=${encodeURIComponent(aliceRoot)}`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [{ field: 'files', name: 'mine.txt', mime: 'text/plain', bytes: Buffer.from('mine') }]),
    });
    assert.equal(own.statusCode, 200, own.body);

    const cross = await app.inject({
      method: 'POST',
      url: `/api/uploads?cwd=${encodeURIComponent(bobRoot)}`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [{ field: 'files', name: 'stolen.txt', mime: 'text/plain', bytes: Buffer.from('nope') }]),
    });
    assert.equal(cross.statusCode, 403, cross.body);
    assert.equal(countFiles(join(bobRoot, '.claudecode-web', 'uploads')), 0);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function multipartBody(
  boundary: string,
  files: Array<{ field: string; name: string; mime: string; bytes: Buffer }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\n`
      + `Content-Type: ${file.mime}\r\n\r\n`,
    ));
    chunks.push(file.bytes, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function countFiles(path: string): number {
  try {
    return readdirSync(path).reduce((count: number, name: string) => {
      const child = join(path, name);
      return count + (statSync(child).isDirectory() ? countFiles(child) : 1);
    }, 0);
  } catch {
    return 0;
  }
}
