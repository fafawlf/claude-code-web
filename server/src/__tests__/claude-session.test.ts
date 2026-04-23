import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSession } from '../session/ClaudeSession.js';

function stubs() {
  return { onPermission: () => false, onPlan: () => false };
}

test('initial state: permissionMode defaults to default when not provided', () => {
  const s = new ClaudeSession({ id: 'id-1', cwd: '/tmp', ...stubs() });
  assert.equal(s.getState().permissionMode, 'default');
  assert.equal(s.getState().cwd, '/tmp');
  assert.equal(s.getState().sessionId, 'id-1');
  void s.close();
});

test('initial state: permissionMode = plan when passed', () => {
  const s = new ClaudeSession({ id: 'id-2', cwd: '/tmp', permissionMode: 'plan', ...stubs() });
  assert.equal(s.getState().permissionMode, 'plan');
  void s.close();
});

test('initial state: resume sets claudeSessionId before any event arrives', () => {
  const s = new ClaudeSession({
    id: 'id-3',
    cwd: '/tmp',
    resume: 'abc-claude-uuid',
    ...stubs(),
  });
  assert.equal(s.getState().claudeSessionId, 'abc-claude-uuid');
  void s.close();
});

test('setPermissionMode before query is constructed updates state without throwing', async () => {
  // Using resume forces the history-load path where this.query starts undefined.
  // The SDK call to getSessionMessages will fail (no such session on disk),
  // but updateState should still reflect the user's intent.
  const s = new ClaudeSession({
    id: 'id-4',
    cwd: '/nonexistent-ccw-test',
    resume: 'does-not-exist-either',
    ...stubs(),
  });
  // Immediately, before history finishes resolving:
  await s.setPermissionMode('plan');
  assert.equal(s.getState().permissionMode, 'plan');
  await s.setModel('claude-opus-4-7');
  assert.equal(s.getState().model, 'claude-opus-4-7');
  await s.close();
});

test('state listeners fire with the delta on updateState', async () => {
  const s = new ClaudeSession({ id: 'id-5', cwd: '/tmp', ...stubs() });
  const deltas: any[] = [];
  s.subscribeState((d) => deltas.push(d));
  await s.setPermissionMode('acceptEdits');
  assert.ok(deltas.some((d) => d.permissionMode === 'acceptEdits'));
  await s.close();
});
