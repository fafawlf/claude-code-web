import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';

test('POST /api/dirs creates a new folder under the requested parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-dirs-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dirs?t=tok',
      payload: { parentPath: root, name: 'new-project' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { path: join(root, 'new-project') });
    assert.equal(existsSync(join(root, 'new-project')), true);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/dirs rejects unsafe folder names', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-dirs-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dirs?t=tok',
      payload: { parentPath: root, name: '../outside' },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Folder name cannot contain/);
    assert.equal(existsSync(join(root, 'outside')), false);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});
