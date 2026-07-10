import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { ActivityRow } from '../components/ActivitySection';
import { FolderRow, ProjectLauncher } from '../components/ProjectLauncher';

(globalThis as unknown as { React: typeof React }).React = React;

// Regression: QA-A11Y-003 — session actions were hover-only and tiny on touch screens
// Found by /qa on 2026-07-10
test('session and top-bar actions remain visible to keyboard and touch users', () => {
  const sidebar = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/repo',
    projects: [{ path: '/root/repo', lastUsed: 1 }],
    projectSessions: { '/root/repo': [{ sessionId: 's1', customTitle: 'Review auth', lastModified: 1 }] },
    activeId: null,
    activeSession: null,
    activitySummary: { total: 0, label: '', tone: 'neutral', needsReviewCount: 0, workingCount: 0, issueCount: 0, finishedCount: 0 },
    activitySessions: [],
    onNewInProject: () => {},
    onResume: () => {},
    onView: () => {},
    onOpenActivity: () => {},
    onEndActivity: () => {},
    onRefresh: () => {},
    onRename: () => {},
    connected: true,
    onOpenCommandPalette: () => {},
    onOpenProject: () => {},
  }));
  assert.match(sidebar, /group-focus-within:opacity-100/);
  assert.match(sidebar, /session-action-button/);
  assert.match(sidebar, /min-w-11/);
  assert.match(sidebar, /aria-label="View Review auth read-only"/);
  assert.match(sidebar, /aria-label="Rename Review auth"/);

  const activity = renderToStaticMarkup(createElement(ActivityRow, {
    session: {
      sessionId: 'live-1',
      title: 'Fix checkout',
      subtitle: '~/repo · now',
      status: 'working',
      statusLabel: 'Working',
      tone: 'info',
      lastEventAt: 1,
    },
    onOpen: () => {},
    onEnd: () => {},
  }));
  assert.match(activity, /min-h-11/);
  assert.match(activity, /group-focus-within:opacity-100/);

  const topbar = renderToStaticMarkup(createElement(TopBar, {
    state: null,
    cwd: '/root/repo',
    onOpenProject: () => {},
    onSelectNodeProvider: () => {},
    onSelectModel: () => {},
    onSelectClaudeAuthMode: () => {},
    onContinueWithApi: () => {},
    skin: 'warm',
    onSelectSkin: () => {},
    onRename: () => {},
    sessionTitle: 'Review auth',
    connected: true,
  }));
  assert.match(topbar, /aria-label="Choose project folder"/);
  assert.match(topbar, /aria-label="Rename session Review auth"/);

  const launcher = renderToStaticMarkup(createElement(ProjectLauncher, {
    token: 't',
    current: '/root/repo',
    recents: [{ path: '/root/other', lastUsed: 1 }],
    pinned: [],
    onClose: () => {},
    onPick: () => {},
    onTogglePin: () => {},
  }));
  assert.match(launcher, /group-focus-within:opacity-100/);

  const folder = renderToStaticMarkup(createElement(FolderRow, {
    label: 'src',
    path: '/root/repo/src',
    selected: false,
    onSelect: () => {},
    onOpen: () => {},
  }));
  assert.match(folder, /group-focus-within:opacity-100/);
});

test('focus and reduced-motion preferences have explicit global behavior', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-hi\)/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*animation:\s*none\s*!important/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*transition-duration:\s*0\.01ms\s*!important/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*transform:\s*none\s*!important/);
});

test('small muted text meets AA contrast in warm, WeChat, and catgirl skins', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const themes = [
    { selector: ':root', background: '--bg-hover' },
    { selector: 'html[data-skin="wechat"]', background: '--bg-hover' },
    { selector: 'html[data-skin="catgirl"]', background: '--bg-hover' },
  ];

  for (const theme of themes) {
    const vars = readVariables(css, theme.selector);
    const contrast = contrastRatio(vars['--text-muted'], vars[theme.background]);
    assert.ok(contrast >= 4.5, `${theme.selector} muted contrast is ${contrast.toFixed(2)}:1`);
  }
});

function readVariables(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `missing theme block ${selector}`);
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

function contrastRatio(a: string, b: string): number {
  assert.ok(a && b, `missing contrast colors: ${a}, ${b}`);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((v) => {
    const channel = Number.parseInt(v, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
