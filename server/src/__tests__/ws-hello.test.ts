import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session/SessionManager.js';
import { resolveHelloSession } from '../ws.js';

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
  assert.equal(resolved.session.getState().claudeSessionId, 'claude-transcript-id');
  assert.equal(resolved.session.getState().model, 'claude-opus-4-7');
  assert.equal(resolved.session.getState().permissionMode, 'acceptEdits');
  await sm.closeAll();
});
