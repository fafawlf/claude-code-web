import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveActivitySessions } from '../activity';
import { abbreviateHome } from '../pathDisplay';

test('home abbreviation uses the server home and respects path boundaries', () => {
  assert.equal(abbreviateHome('/Users/alice/work/app', '/Users/alice'), '~/work/app');
  assert.equal(abbreviateHome('/Users/alice', '/Users/alice/'), '~');
  assert.equal(abbreviateHome('/Users/alice-archive/app', '/Users/alice'), '/Users/alice-archive/app');
});

test('activity labels abbreviate a non-root server home', () => {
  const now = 1_700_000_000_000;
  const rows = deriveActivitySessions({
    liveSessions: [{
      sessionId: 'session',
      nodeId: 'local',
      provider: 'claude',
      cwd: '/Users/alice/work/deep/project',
      permissionMode: 'default',
      runtimeStatus: 'idle',
      attachedCount: 0,
      lastEventId: 1,
      lastEventAt: now,
      tokensIn: 0,
      tokensOut: 0,
      claudeSessionId: 'claude-session',
    }],
    activeSessionId: null,
    cache: new Map(),
    storedSessions: [],
    home: '/Users/alice',
    now,
  });

  assert.equal(rows[0]?.subtitle, '~/deep/project · just now');
});
