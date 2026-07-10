import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectViews } from '../components/Sidebar';

// Regression: ISSUE-002 — matching a project name hid every chat in that project
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('project search keeps all chats in a matching project', () => {
  const views = buildProjectViews(
    [{ path: '/root/lifanwang', lastUsed: 1 }],
    {
      '/root/lifanwang': [
        { sessionId: 'auth', customTitle: 'Fix login', lastModified: 2 },
        { sessionId: 'billing', customTitle: 'Review billing', lastModified: 1 },
      ],
    },
    'lifanwang',
    null,
  );

  assert.deepEqual(views[0]?.sessions.map((session) => session.sessionId), ['auth', 'billing']);
});

test('chat search keeps the current session visible beside matching chats', () => {
  const views = buildProjectViews(
    [{ path: '/root/project', lastUsed: 1 }],
    {
      '/root/project': [
        { sessionId: 'current', customTitle: 'Investigate auth', lastModified: 2 },
        { sessionId: 'match', customTitle: 'Billing regression', lastModified: 1 },
      ],
    },
    'billing',
    'current',
  );

  assert.deepEqual(views[0]?.sessions.map((session) => session.sessionId), ['current', 'match']);
});
