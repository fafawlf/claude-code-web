import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMessageForAttachment, readyUsesExplicitReplay, replayModeForReady } from '../attachment';
import type { ServerMessage, SessionStateSnapshot } from '../types';

// Regression: QA-ATTACH-001 — delayed frames from A could overwrite session B.
// Found by /qa on 2026-07-10.
const attachment = {
  attachId: 'attach-b',
  requestedSessionId: 'session-b',
  allowLegacyFrames: false,
};

function snapshot(sessionId: string): SessionStateSnapshot {
  return {
    sessionId,
    nodeId: 'local',
    provider: 'claude',
    cwd: '/tmp',
    permissionMode: 'default',
    runtimeStatus: 'idle',
    attachedCount: 1,
    lastEventId: 0,
    lastEventAt: 1,
    tokensIn: 0,
    tokensOut: 0,
  };
}

test('attachment scope rejects stale attach ids and stale session ids', () => {
  const staleAttach: ServerMessage = {
    type: 'sdk_event',
    attachId: 'attach-a',
    sessionId: 'session-b',
    id: 1,
    event: { type: 'result' },
  };
  const staleSession: ServerMessage = {
    type: 'state_update',
    attachId: 'attach-b',
    sessionId: 'session-a',
    state: { runtimeStatus: 'running' },
  };
  const current: ServerMessage = {
    type: 'sdk_event',
    attachId: 'attach-b',
    sessionId: 'session-b',
    id: 2,
    event: { type: 'result' },
  };

  assert.equal(isMessageForAttachment(staleAttach, attachment, 'session-b'), false);
  assert.equal(isMessageForAttachment(staleSession, attachment, 'session-b'), false);
  assert.equal(isMessageForAttachment(current, attachment, 'session-b'), true);
});

test('attachment scope remains compatible with legacy unscoped frames', () => {
  const initialAttachment = { ...attachment, allowLegacyFrames: true };
  assert.equal(isMessageForAttachment({ type: 'sdk_event', id: 1, event: { type: 'result' } }, initialAttachment, 'session-b'), true);
  assert.equal(isMessageForAttachment({ type: 'sessions_update', sessions: [] }, attachment, 'session-b'), true);
});

test('an unscoped replay from A is rejected after switching to B', () => {
  const staleLegacyBatch: ServerMessage = {
    type: 'sdk_events_batch',
    events: [{ id: 7, event: { type: 'assistant', message: { content: 'stale A' } } }],
  };
  const staleLegacyReady: ServerMessage = {
    type: 'ready',
    state: snapshot('session-a'),
  };

  assert.equal(isMessageForAttachment(staleLegacyBatch, attachment, 'session-b'), false);
  assert.equal(isMessageForAttachment(staleLegacyReady, attachment, 'session-b'), false);
});

test('matching attach id accepts ready when an expired runtime id is recovered to a new session id', () => {
  const recoveredReady: ServerMessage = {
    type: 'ready',
    attachId: 'attach-b',
    sessionId: 'session-recovered',
    state: snapshot('session-recovered'),
    replayMode: 'full',
    historyStatus: 'loading',
  };

  assert.equal(isMessageForAttachment(recoveredReady, attachment, 'session-b'), true);
});

test('ready replay mode is explicit when supplied and inferred for legacy servers', () => {
  const explicit: Extract<ServerMessage, { type: 'ready' }> = {
    type: 'ready',
    attachId: 'attach-b',
    sessionId: 'session-b',
    state: snapshot('session-b'),
    replayMode: 'full',
    historyStatus: 'loading',
  };
  const legacy: Extract<ServerMessage, { type: 'ready' }> = {
    type: 'ready',
    state: snapshot('session-b'),
  };

  assert.equal(readyUsesExplicitReplay(explicit), true);
  assert.equal(replayModeForReady(explicit, 42), 'full');
  assert.equal(readyUsesExplicitReplay(legacy), false);
  assert.equal(replayModeForReady(legacy, 42), 'delta');
  assert.equal(replayModeForReady(legacy, 0), 'full');
});
