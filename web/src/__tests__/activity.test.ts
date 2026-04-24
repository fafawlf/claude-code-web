import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveActivitySessions, deriveActivitySummary } from '../activity';
import type { ChatState } from '../reducer';
import type { SessionStateSnapshot, StoredSession } from '../types';

const now = 1_700_000_000_000;

function snap(overrides: Partial<SessionStateSnapshot> & { sessionId: string }): SessionStateSnapshot {
  return {
    sessionId: overrides.sessionId,
    cwd: '/root/project',
    permissionMode: 'default',
    runtimeStatus: 'running',
    attachedCount: 0,
    lastEventId: 1,
    lastEventAt: now - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    ...overrides,
  };
}

function cachedUser(text: string): ChatState {
  return {
    items: [{ kind: 'user', id: 'u1', text }],
    busy: false,
    lastEventId: 1,
    state: null,
    streamingText: '',
  };
}

test('activity excludes current, closed, viewer, and empty detached sessions', () => {
  const cache = new Map<string, ChatState>();
  cache.set('real-bg', cachedUser('Fix the flaky test'));

  const rows = deriveActivitySessions({
    liveSessions: [
      snap({ sessionId: 'active' }),
      snap({ sessionId: 'closed', runtimeStatus: 'closed' }),
      snap({ sessionId: 'viewer', viewerMode: true }),
      snap({ sessionId: 'empty', runtimeStatus: 'idle', lastEventId: 0, claudeSessionId: undefined }),
      snap({ sessionId: 'real-bg' }),
    ],
    activeSessionId: 'active',
    cache,
    storedSessions: [],
    now,
  });

  assert.deepEqual(rows.map((r) => r.sessionId), ['real-bg']);
  assert.equal(rows[0].title, 'Fix the flaky test');
});

test('activity groups permission and plan waits under needs review summary', () => {
  const rows = deriveActivitySessions({
    liveSessions: [
      snap({ sessionId: 'perm', runtimeStatus: 'waiting_permission', claudeSessionId: 'c1' }),
      snap({ sessionId: 'plan', runtimeStatus: 'waiting_plan', claudeSessionId: 'c2' }),
      snap({ sessionId: 'work', runtimeStatus: 'running', claudeSessionId: 'c3' }),
    ],
    activeSessionId: null,
    cache: new Map(),
    storedSessions: [],
    now,
  });
  const summary = deriveActivitySummary(rows);

  assert.deepEqual(rows.map((r) => r.status), ['needs_review', 'plan_ready', 'working']);
  assert.equal(summary.label, '2 needs review');
  assert.equal(summary.tone, 'warning');
  assert.equal(summary.needsReviewCount, 2);
});

test('activity title prefers cached prompt, then stored title, then cwd fallback', () => {
  const cache = new Map<string, ChatState>();
  cache.set('cached', cachedUser('Use cached prompt as the task title'));

  const storedSessions: StoredSession[] = [
    { sessionId: 'claude-stored', customTitle: 'Stored title', lastModified: now },
  ];

  const rows = deriveActivitySessions({
    liveSessions: [
      snap({ sessionId: 'cached', claudeSessionId: 'claude-cached' }),
      snap({ sessionId: 'stored', claudeSessionId: 'claude-stored' }),
      snap({ sessionId: 'fallback', cwd: '/root/very/deep/project', claudeSessionId: 'claude-fallback', lastEventAt: now - 3_600_000 }),
    ],
    activeSessionId: null,
    cache,
    storedSessions,
    now,
  });

  assert.equal(rows.find((r) => r.sessionId === 'cached')?.title, 'Use cached prompt as the task title');
  assert.equal(rows.find((r) => r.sessionId === 'stored')?.title, 'Stored title');
  assert.equal(rows.find((r) => r.sessionId === 'fallback')?.title, '~/deep/project · 1h ago');
});

test('activity summary uses issue and finished labels when they are the top visible state', () => {
  const issue = deriveActivitySummary(deriveActivitySessions({
    liveSessions: [snap({ sessionId: 'bad', runtimeStatus: 'error', claudeSessionId: 'c1' })],
    activeSessionId: null,
    cache: new Map(),
    storedSessions: [],
    now,
  }));
  const finished = deriveActivitySummary(deriveActivitySessions({
    liveSessions: [snap({ sessionId: 'done', runtimeStatus: 'idle', claudeSessionId: 'c2' })],
    activeSessionId: null,
    cache: new Map(),
    storedSessions: [],
    now,
  }));

  assert.equal(issue.label, '1 issue');
  assert.equal(issue.tone, 'danger');
  assert.equal(finished.label, '1 finished');
  assert.equal(finished.tone, 'neutral');
});

test('activity hides finished sessions once they are available in history', () => {
  const rows = deriveActivitySessions({
    liveSessions: [
      snap({ sessionId: 'done', runtimeStatus: 'idle', claudeSessionId: 'claude-done' }),
      snap({ sessionId: 'not-yet-indexed', runtimeStatus: 'idle', claudeSessionId: 'claude-later' }),
    ],
    activeSessionId: null,
    cache: new Map(),
    storedSessions: [{ sessionId: 'claude-done', summary: 'Done in history', lastModified: now }],
    now,
  });

  assert.deepEqual(rows.map((r) => r.sessionId), ['not-yet-indexed']);
  assert.equal(deriveActivitySummary(rows).label, '1 finished');
});
