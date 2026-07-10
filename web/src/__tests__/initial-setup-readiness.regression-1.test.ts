import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InitialSetup } from '../components/InitialSetup';

(globalThis as unknown as { React: typeof React }).React = React;

// Regression: ISSUE-009 — setup allowed Continue with no executable or authentication
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('setup blocks Continue until Claude Code and authentication are ready', () => {
  const blocked = renderToStaticMarkup(createElement(InitialSetup, {
    cwd: '/root/project',
    auth: { source: 'none', label: 'No Claude auth' },
    claude: { source: 'missing', label: 'Claude executable not found' },
    onDone: () => {},
    onOpenProject: () => {},
  }));
  const ready = renderToStaticMarkup(createElement(InitialSetup, {
    cwd: '/root/project',
    auth: { source: 'account', label: 'Claude Max' },
    claude: { source: 'path', label: 'claude on PATH' },
    onDone: () => {},
    onOpenProject: () => {},
  }));

  assert.match(blocked, /Resolve the Claude Code installation/);
  assert.match(blocked, /disabled=""/);
  assert.match(blocked, /aria-describedby="setup-blocked-reason"/);
  assert.doesNotMatch(ready, /setup-blocked-reason/);
  assert.doesNotMatch(ready, /disabled=""/);
});
