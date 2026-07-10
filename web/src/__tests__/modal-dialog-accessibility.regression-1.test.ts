import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PermissionModal } from '../components/PermissionModal';
import { PlanApprovalModal } from '../components/PlanApprovalModal';
import { InitialSetup } from '../components/InitialSetup';
import { CommandPalette } from '../components/CommandPalette';
import { ProjectLauncher } from '../components/ProjectLauncher';
import { AdminUsersModal } from '../components/AdminUsersModal';

(globalThis as unknown as { React: typeof React }).React = React;

// Regression: QA-A11Y-002 — dialogs had no programmatic title and Escape leaked to the app
// Found by /qa on 2026-07-10
test('every top-level dialog has a programmatic title', () => {
  const dialogs = [
    renderToStaticMarkup(createElement(PermissionModal, {
      req: { type: 'permission_request', reqId: 'p1', toolName: 'Bash', input: { command: 'pwd' } },
      onAllow: () => {},
      onDeny: () => {},
    })),
    renderToStaticMarkup(createElement(PlanApprovalModal, {
      plan: '# Plan',
      onApprove: () => {},
      onReject: () => {},
    })),
    renderToStaticMarkup(createElement(InitialSetup, {
      cwd: '/root/repo',
      auth: { source: 'api', plan: null, label: 'API', detail: 'key' },
      claude: { source: 'path', path: '/usr/bin/claude', label: 'Claude Code' },
      onDone: () => {},
      onOpenProject: () => {},
    })),
    renderToStaticMarkup(createElement(CommandPalette, {
      open: true,
      onClose: () => {},
      state: null,
      sessions: [],
      currentSkin: 'warm',
      currentProvider: 'claude',
      onAction: () => {},
    })),
    renderToStaticMarkup(createElement(ProjectLauncher, {
      token: 't',
      current: '/root/repo',
      recents: [],
      pinned: [],
      onClose: () => {},
      onPick: () => {},
      onTogglePin: () => {},
    })),
    renderToStaticMarkup(createElement(AdminUsersModal, { onClose: () => {} })),
  ];

  for (const html of dialogs) {
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    const label = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(label, `dialog is missing aria-labelledby: ${html.slice(0, 160)}`);
    assert.ok(html.includes(`id="${label}"`), `dialog title id ${label} is missing`);
  }
});

test('the focus trap owns Escape, contains stray focus, and restores the opener', () => {
  const source = readFileSync(new URL('../hooks/useFocusTrap.ts', import.meta.url), 'utf8');

  assert.match(source, /document\.addEventListener\('keydown',\s*onKey,\s*true\)/);
  assert.match(source, /document\.addEventListener\('focusin',\s*onFocusIn,\s*true\)/);
  assert.match(source, /e\.stopPropagation\(\)/);
  assert.match(source, /previousFocus\?\.focus/);
});
