import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityRow } from '../components/ActivitySection';
import type { ActivitySessionViewModel } from '../activity';

(globalThis as unknown as { React: typeof React }).React = React;

function row(status: ActivitySessionViewModel['status']): ActivitySessionViewModel {
  return {
    sessionId: 'session-1',
    nodeId: 'local',
    provider: 'claude',
    title: 'Fix session switching',
    subtitle: '~/project · just now',
    status,
    statusLabel: status === 'finished' ? 'Finished' : 'Working',
    tone: status === 'finished' ? 'neutral' : 'info',
    lastEventAt: 1,
  };
}

// Regression: ISSUE-004 — finished activity rows exposed a destructive-looking End action
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('finished activity uses Dismiss while active work keeps End', () => {
  const finished = renderToStaticMarkup(createElement(ActivityRow, {
    session: row('finished'),
    onOpen: () => {},
    onEnd: () => {},
  }));
  const working = renderToStaticMarkup(createElement(ActivityRow, {
    session: row('working'),
    onOpen: () => {},
    onEnd: () => {},
  }));

  assert.match(finished, />Dismiss<\/button>/);
  assert.match(finished, /Dismiss this finished task/);
  assert.match(working, />End<\/button>/);
  assert.match(working, /End this task/);
});
