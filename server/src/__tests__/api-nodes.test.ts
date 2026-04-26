import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';
import { NodeRegistry, parseExtraNodes } from '../nodes/NodeRegistry.js';

test('GET /api/nodes exposes local node without secrets', async () => {
  const app = Fastify();
  const sm = new SessionManager();
  registerApi(app, 'tok', '/tmp/project', sm);

  const res = await app.inject({ method: 'GET', url: '/api/nodes?t=tok' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.nodes[0].id, 'local');
  assert.equal(body.nodes[0].kind, 'local');
  assert.ok(body.nodes[0].providers.includes('claude'));
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

test('NodeRegistry parses configured ssh nodes without exposing ssh secrets', async () => {
  const configured = parseExtraNodes(JSON.stringify({
    nodes: [{
      id: 'do',
      label: 'DO workspace',
      kind: 'ssh',
      defaultCwd: '/root/workspace',
      providers: ['claude', 'codex', 'unknown'],
      ssh: { host: 'ssh-node.example', user: 'developer', port: 22 },
    }],
  }));

  assert.equal(configured.length, 1);
  assert.equal(configured[0].ssh?.host, 'ssh-node.example');

  const registry = new NodeRegistry('/tmp/project', configured);
  const listed = registry.list();
  assert.equal(listed[0].id, 'do');
  assert.deepEqual(listed[0].providers, ['claude', 'codex']);
  assert.equal((listed[0] as { ssh?: unknown }).ssh, undefined);
});
