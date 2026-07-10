import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderRow } from '../components/ProjectLauncher';

(globalThis as unknown as { React: typeof React }).React = React;

// Regression: ISSUE-008 — navigating folders required a double click unavailable on touch
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('folder rows expose a touch-sized explicit open action', () => {
  const html = renderToStaticMarkup(createElement(FolderRow, {
    label: 'src',
    path: '/root/project/src',
    selected: false,
    onSelect: () => {},
    onOpen: () => {},
  }));

  assert.match(html, /aria-label="Open src"/);
  assert.match(html, /min-w-11/);
  assert.match(html, />Open<\/button>/);
});

test('the current-folder row labels its explicit action as Choose', () => {
  const html = renderToStaticMarkup(createElement(FolderRow, {
    label: 'Choose this folder',
    path: '/root/project',
    selected: true,
    emphasized: true,
    onSelect: () => {},
    onOpen: () => {},
  }));

  assert.match(html, /aria-label="Choose this folder"/);
  assert.match(html, />Choose<\/button>/);
});
