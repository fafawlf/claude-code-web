import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type ChatState } from '../reducer';
import { cachedLastEventId, rememberChatState } from '../sessionCache';

function stateFor(sessionId: string, lastEventId: number): ChatState {
  return {
    ...initialState,
    lastEventId,
    state: {
      sessionId,
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
  rememberChatState(cache, null, stateFor('a', 4));
  rememberChatState(cache, null, stateFor('b', 9));

  assert.equal(cachedLastEventId(cache, 'a'), 4);
  assert.equal(cachedLastEventId(cache, 'b'), 9);
});

test('rememberChatState can key pre-ready state by active session id', () => {
  const cache = new Map<string, ChatState>();
  rememberChatState(cache, 'active-web-session', { ...initialState, lastEventId: 12 });

  assert.equal(cachedLastEventId(cache, 'active-web-session'), 12);
});
