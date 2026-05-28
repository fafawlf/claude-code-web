import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type ChatState } from '../reducer';
import { cachedChatState, cachedLastEventId, chatStateForReady, rememberChatState, sessionCacheKey } from '../sessionCache';

function stateFor(sessionId: string, lastEventId: number): ChatState {
  return {
    ...initialState,
    lastEventId,
    state: {
      sessionId,
      nodeId: 'local',
      provider: 'claude',
      cwd: '/tmp',
      permissionMode: 'default',
      runtimeStatus: 'idle',
      attachedCount: 0,
      lastEventId,
      lastEventAt: 1,
      tokensIn: 0,
      tokensOut: 0,
    },
  };
}

test('rememberChatState keeps independent ChatState entries per session', () => {
  const cache = new Map<string, ChatState>();
  const a = stateFor('a', 4);
  const b = stateFor('b', 9);
  rememberChatState(cache, null, a);
  rememberChatState(cache, null, b);

  assert.equal(cachedLastEventId(cache, a.state!), 4);
  assert.equal(cachedLastEventId(cache, b.state!), 9);
});

test('sessionCacheKey includes node and provider to avoid cross-node collisions', () => {
  const cache = new Map<string, ChatState>();
  const doClaude = stateFor('same-session-id', 4);
  doClaude.state = { ...doClaude.state!, nodeId: 'do', provider: 'claude' };
  const macCodex = stateFor('same-session-id', 9);
  macCodex.state = { ...macCodex.state!, nodeId: 'macbook', provider: 'codex' };

  rememberChatState(cache, null, doClaude);
  rememberChatState(cache, null, macCodex);

  assert.equal(sessionCacheKey(doClaude.state!), 'do:claude:same-session-id');
  assert.equal(sessionCacheKey(macCodex.state!), 'macbook:codex:same-session-id');
  assert.equal(cachedLastEventId(cache, doClaude.state!), 4);
  assert.equal(cachedLastEventId(cache, macCodex.state!), 9);
  assert.equal(cachedChatState(cache, 'same-session-id'), undefined);
});

test('rememberChatState can key pre-ready state by active session id', () => {
  const cache = new Map<string, ChatState>();
  rememberChatState(cache, 'active-web-session', { ...initialState, lastEventId: 12 });

  assert.equal(cachedLastEventId(cache, 'active-web-session'), 12);
});

test('chatStateForReady carries visible history from read-only viewer into writable takeover', () => {
  const viewer = stateFor('viewer-web-session', 75);
  viewer.state = {
    ...viewer.state!,
    providerSessionId: 'claude-transcript-id',
    claudeSessionId: 'claude-transcript-id',
    viewerMode: true,
  };
  viewer.items = [{ kind: 'assistant_text', id: 'a1', text: 'Already visible plan' }];
  viewer.busy = true;
  viewer.streamingText = 'stale';

  const writable = {
    ...viewer.state!,
    sessionId: 'writable-web-session',
    viewerMode: false,
    runtimeStatus: 'idle' as const,
  };

  const next = chatStateForReady(viewer, undefined, writable);
  assert.equal(next.items.length, 1);
  assert.equal((next.items[0] as any).text, 'Already visible plan');
  assert.equal(next.busy, false);
  assert.equal(next.streamingText, '');
});

test('chatStateForReady does not carry history across different providers or transcripts', () => {
  const viewer = stateFor('viewer-web-session', 75);
  viewer.state = {
    ...viewer.state!,
    providerSessionId: 'claude-transcript-id',
    claudeSessionId: 'claude-transcript-id',
    viewerMode: true,
  };
  viewer.items = [{ kind: 'assistant_text', id: 'a1', text: 'Wrong chat' }];

  const other = {
    ...viewer.state!,
    sessionId: 'other-web-session',
    providerSessionId: 'different-transcript-id',
    claudeSessionId: 'different-transcript-id',
    viewerMode: false,
  };

  const next = chatStateForReady(viewer, undefined, other);
  assert.equal(next.items.length, 0);
});
