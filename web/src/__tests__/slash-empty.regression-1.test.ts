import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlashPalette } from '../components/SlashPalette';

(globalThis as unknown as { React: typeof React }).React = React;

// Regression: ISSUE-011 — unknown slash commands rendered no menu and silently swallowed Enter
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('unknown slash commands keep an actionable empty state visible', () => {
  const html = renderToStaticMarkup(createElement(SlashPalette, {
    query: 'definitely-not-a-command',
    provider: 'claude',
    onPick: () => {},
    onClose: () => {},
    onEmptySubmit: () => {},
  }));

  assert.match(html, /No matching command/);
  assert.match(html, /Press Enter to send it as text/);
  assert.match(html, /role="status"/);
});
