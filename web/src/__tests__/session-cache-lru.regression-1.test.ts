import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type ChatState } from '../reducer';
import { cachedChatState, displaySessionKey, rememberChatState, SessionCache, sessionCacheKey, transcriptCacheKey } from '../sessionCache';
import type { SessionStateSnapshot } from '../types';

// Regression: QA-CACHE-001 — recreated viewer sessions lost or duplicated the same transcript cache.
// Found by /qa on 2026-07-10.
function snapshot(sessionId: string, transcriptId: string): SessionStateSnapshot {
  return {
    sessionId,
    nodeId: 'do',
    provider: 'claude',
    providerSessionId: transcriptId,
    claudeSessionId: transcriptId,
    cwd: '/root/project',
    permissionMode: 'default',
    runtimeStatus: 'idle',
    attachedCount: 1,
    lastEventId: 4,
    lastEventAt: 1,
    tokensIn: 0,
    tokensOut: 0,
  };
}

function chat(snap: SessionStateSnapshot, text: string): ChatState {
  return {
    ...initialState,
    state: snap,
    lastEventId: snap.lastEventId,
    items: [{ kind: 'assistant_text', id: `item-${snap.sessionId}`, text }],
  };
}

test('SessionCache aliases runtime ids to one stable transcript entry', () => {
  const cache = new SessionCache();
  const oldRuntime = snapshot('runtime-old', 'transcript-1');
  const newRuntime = { ...oldRuntime, sessionId: 'runtime-new', lastEventId: 8 };

  rememberChatState(cache, oldRuntime.sessionId, chat(oldRuntime, 'old'));
  rememberChatState(cache, newRuntime.sessionId, chat(newRuntime, 'fresh'));

  assert.equal(cache.size, 1);
  assert.equal(cachedChatState(cache, oldRuntime)?.lastEventId, 8);
  assert.equal(cachedChatState(cache, newRuntime)?.lastEventId, 8);
  assert.equal(cachedChatState(cache, { ...newRuntime, sessionId: undefined })?.lastEventId, 8);
  assert.equal(displaySessionKey(oldRuntime), transcriptCacheKey(oldRuntime));
  assert.notEqual(displaySessionKey(oldRuntime), sessionCacheKey(oldRuntime));
});

test('SessionCache evicts least-recently-used conversations by unique entry', () => {
  const cache = new SessionCache({ maxSessions: 2, maxBytes: 1024 * 1024 });
  const a = snapshot('a', 'ta');
  const b = snapshot('b', 'tb');
  const c = snapshot('c', 'tc');
  rememberChatState(cache, 'a', chat(a, 'a'));
  rememberChatState(cache, 'b', chat(b, 'b'));
  assert.ok(cachedChatState(cache, a)); // A is newest now.
  rememberChatState(cache, 'c', chat(c, 'c'));

  assert.equal(cache.size, 2);
  assert.ok(cachedChatState(cache, a));
  assert.equal(cachedChatState(cache, b), undefined);
  assert.ok(cachedChatState(cache, c));
});

test('SessionCache refuses a single entry larger than its byte budget', () => {
  const cache = new SessionCache({ maxSessions: 8, maxBytes: 128 });
  const snap = snapshot('large', 'large-transcript');
  rememberChatState(cache, snap.sessionId, chat(snap, 'x'.repeat(500)));

  assert.equal(cache.size, 0);
  assert.equal(cache.totalBytes, 0);
});
