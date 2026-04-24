import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReconnectHello } from '../reconnect';
import { initialState, withReady } from '../reducer';
import type { SessionStateSnapshot } from '../types';

function snap(): SessionStateSnapshot {
  return {
    sessionId: 'live-1',
    claudeSessionId: 'claude-1',
    cwd: '/root/chatgpt',
    model: 'claude-opus-4-7',
    permissionMode: 'bypassPermissions',
    runtimeStatus: 'running',
    attachedCount: 1,
    lastEventId: 10,
    lastEventAt: Date.now(),
    tokensIn: 0,
    tokensOut: 0,
  };
}

test('buildReconnectHello includes recovery fields for expired server-side live sessions', () => {
  const state = withReady(initialState, snap());
  assert.deepEqual(buildReconnectHello('live-1', state, 10), {
    type: 'hello',
    sessionId: 'live-1',
    lastEventId: 10,
    cwd: '/root/chatgpt',
    resumeClaudeId: 'claude-1',
    model: 'claude-opus-4-7',
    permissionMode: 'bypassPermissions',
    viewerMode: undefined,
  });
});

test('buildReconnectHello creates a plain hello before any active session exists', () => {
  assert.deepEqual(buildReconnectHello(null, initialState, 0), { type: 'hello' });
});
