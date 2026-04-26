import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session/SessionManager.js';
import { resolveHelloSession } from '../ws.js';
import { ClaudeProvider } from '../agents/ClaudeProvider.js';
import { NodeRegistry } from '../nodes/NodeRegistry.js';

function makeOpts() {
  return {
    cwd: '/tmp',
    onPermission: () => {},
    onPlan: () => {},
  };
}

test('resolveHelloSession attaches an existing live session with replay id', async () => {
  const sm = new SessionManager();
  const existing = sm.create(makeOpts());
  const resolved = resolveHelloSession(sm, { type: 'hello', sessionId: existing.id, lastEventId: 42 }, '/fallback');

  assert.equal(resolved.session.id, existing.id);
  assert.equal(resolved.replayAfterId, 42);
  assert.equal(resolved.recovered, false);
  assert.equal(resolved.session.getState().nodeId, 'local');
  assert.equal(resolved.session.getState().provider, 'claude');
  await sm.closeAll();
});

test('resolveHelloSession recovers when a browser reconnects with an expired live session id', async () => {
  const sm = new SessionManager();
  const resolved = resolveHelloSession(sm, {
    type: 'hello',
    sessionId: 'expired-live-id',
    cwd: '/workspace/project',
    resumeClaudeId: 'claude-transcript-id',
    model: 'claude-opus-4-7',
    permissionMode: 'acceptEdits',
  }, '/fallback');

  assert.notEqual(resolved.session.id, 'expired-live-id');
  assert.equal(resolved.replayAfterId, 0);
  assert.equal(resolved.recovered, true);
  assert.equal(resolved.session.getState().cwd, '/workspace/project');
  assert.equal(resolved.session.getState().nodeId, 'local');
  assert.equal(resolved.session.getState().provider, 'claude');
  assert.equal(resolved.session.getState().claudeSessionId, 'claude-transcript-id');
  assert.equal(resolved.session.getState().model, 'claude-opus-4-7');
  assert.equal(resolved.session.getState().permissionMode, 'acceptEdits');
  await sm.closeAll();
});

test('resolveHelloSession records requested node and provider on new sessions', async () => {
  const sm = new SessionManager();
  const nodes = new NodeRegistry('/fallback', [{
    id: 'do',
    label: 'DO',
    kind: 'local',
    defaultCwd: '/root',
    providers: ['claude'],
  }]);
  const resolved = resolveHelloSession(sm, {
    type: 'hello',
    nodeId: 'do',
    provider: 'claude',
    cwd: '/root/project',
  }, '/fallback', nodes);

  assert.equal(resolved.session.getState().nodeId, 'do');
  assert.equal(resolved.session.getState().provider, 'claude');
  assert.equal(resolved.session.getState().cwd, '/root/project');
  await sm.closeAll();
});

test('resolveHelloSession refuses to attach a session through the wrong node/provider', async () => {
  const sm = new SessionManager();
  const nodes = new NodeRegistry('/fallback', [
    { id: 'do', label: 'DO', kind: 'local', defaultCwd: '/root', providers: ['claude', 'codex'] },
    { id: 'macbook', label: 'MacBook', kind: 'local', defaultCwd: '/Users/me', providers: ['claude'] },
  ]);
  const existing = sm.create({ ...makeOpts(), nodeId: 'do', provider: 'claude' });

  assert.throws(
    () => resolveHelloSession(sm, { type: 'hello', sessionId: existing.id, nodeId: 'macbook', provider: 'claude' }, '/fallback', nodes),
    /belongs to do\/claude/i
  );
  assert.throws(
    () => resolveHelloSession(sm, { type: 'hello', sessionId: existing.id, nodeId: 'do', provider: 'codex' }, '/fallback', nodes),
    /belongs to do\/claude/i
  );
  await sm.closeAll();
});

test('resolveHelloSession reports unavailable providers instead of misrouting to Claude', async () => {
  const sm = new SessionManager([new ClaudeProvider()]);
  const nodes = new NodeRegistry('/fallback', [{ id: 'do', label: 'DO', kind: 'local', defaultCwd: '/root', providers: ['codex'] }]);
  assert.throws(
    () => resolveHelloSession(sm, { type: 'hello', nodeId: 'do', provider: 'codex', cwd: '/root/project' }, '/fallback', nodes),
    /provider codex is not available yet/i
  );
  await sm.closeAll();
});

test('resolveHelloSession rejects unconfigured and unwired ssh nodes', async () => {
  const sm = new SessionManager();
  const nodes = new NodeRegistry('/fallback', [{
    id: 'remote-do',
    label: 'Remote DO',
    kind: 'ssh',
    defaultCwd: '/root/project',
    providers: ['claude', 'codex'],
    ssh: { host: 'example.internal', user: 'root' },
  }]);

  assert.throws(
    () => resolveHelloSession(sm, { type: 'hello', nodeId: 'missing', provider: 'claude' }, '/fallback', nodes),
    /node missing is not configured/i
  );
  assert.throws(
    () => resolveHelloSession(sm, { type: 'hello', nodeId: 'remote-do', provider: 'claude' }, '/fallback', nodes),
    /remote execution is not wired/i
  );
  await sm.closeAll();
});
