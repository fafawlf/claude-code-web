import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';

test('GET /api/nodes exposes local node without secrets', async () => {
  const app = Fastify();
  const sm = new SessionManager();
  registerApi(app, 'tok', '/tmp/project', sm);

  const res = await app.inject({ method: 'GET', url: '/api/nodes?t=tok' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.nodes[0].id, 'local');
  assert.equal(body.nodes[0].kind, 'local');
  assert.deepEqual(body.nodes[0].providers, ['claude']);
  assert.equal(body.nodes[0].defaultCwd, '/tmp/project');
  assert.equal(body.nodes[0].ssh, undefined);
  await app.close();
});

test('GET /api/node/info reports node-scoped runtime info', async () => {
  const app = Fastify();
  const sm = new SessionManager();
  registerApi(app, 'tok', '/tmp/project', sm);

  const res = await app.inject({ method: 'GET', url: '/api/node/info?t=tok&nodeId=local' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.node.id, 'local');
  assert.equal(body.cwd, '/tmp/project');
  assert.ok(body.claude);
  assert.ok(body.codex);
  assert.ok(body.server.platform);
  await app.close();
});

test('GET /api/node/info rejects unknown nodes', async () => {
  const app = Fastify();
  const sm = new SessionManager();
  registerApi(app, 'tok', '/tmp/project', sm);

  const res = await app.inject({ method: 'GET', url: '/api/node/info?t=tok&nodeId=missing' });
  assert.equal(res.statusCode, 404);
  await app.close();
});
