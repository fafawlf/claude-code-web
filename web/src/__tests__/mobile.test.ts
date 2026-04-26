import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopBar } from '../components/TopBar';
import { MessageList } from '../components/MessageList';
import { InputBar } from '../components/InputBar';
import { SkinMenu } from '../components/SkinMenu';

(globalThis as unknown as { React: typeof React }).React = React;

test('TopBar exposes a mobile projects drawer trigger without replacing project picker', () => {
  const html = renderToStaticMarkup(createElement(TopBar, {
    state: null,
    cwd: '/root/random shit',
    auth: { source: 'api', plan: null, label: 'API', detail: 'ANTHROPIC_API_KEY' },
    nodes: [{ id: 'local', label: 'This machine', kind: 'local', defaultCwd: '/root/random shit', providers: ['claude', 'codex'], connected: true }],
    selectedNodeId: 'local',
    selectedProvider: 'claude',
    onOpenSidebar: () => {},
    onOpenProject: () => {},
    onSelectNodeProvider: () => {},
    onSelectModel: () => {},
    skin: 'warm',
    onSelectSkin: () => {},
    onRename: () => {},
    connected: true,
  }));

  assert.match(html, /mobile-sidebar-button/);
  assert.match(html, /Open projects/);
  assert.match(html, /Claude Code/);
  assert.doesNotMatch(html, /API/);
  assert.match(html, /random shit/);
});

test('MessageList marks mobile-safe scroll and bottom jump elements', () => {
  const html = renderToStaticMarkup(createElement(MessageList, {
    token: 'tok',
    cwd: '/root/app',
    skin: 'warm',
    items: [{ kind: 'assistant_text', id: 'a1', text: 'hello' }],
    busy: false,
    streamingText: '',
    pendingByToolUseId: new Map(),
    secondsSinceLastEvent: 0,
    onAcceptEdit: () => {},
    onRejectEdit: () => {},
    onStop: () => {},
  }));

  assert.match(html, /message-scroller/);
  assert.match(html, /message-list-content/);
});

test('mobile menu popovers use unclipped responsive classes', () => {
  const skin = renderToStaticMarkup(createElement(SkinMenu, {
    current: 'warm',
    onSelect: () => {},
  }));

  const input = renderToStaticMarkup(createElement(InputBar, {
    token: 't',
    cwd: '/tmp',
    mode: 'bypassPermissions',
    busy: false,
    ready: true,
    onSend: () => {},
    onStop: () => {},
    onSlashAction: () => {},
    onCycleMode: () => {},
    onSetMode: () => {},
  }));

  assert.match(skin, /topbar-menu/);
  assert.match(skin, /aria-haspopup="menu"/);
  assert.match(input, /composer-permission-button/);
});

test('mobile layout pins composer to visual viewport without horizontal page overflow', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  assert.match(html, /interactive-widget=overlays-content/);
  assert.match(css, /--keyboard-offset/);
  assert.match(css, /\.composer-wrap\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.composer-wrap\s*\{[^}]*translate3d\(0,\s*calc\(-1 \* var\(--keyboard-offset/s);
  assert.match(css, /\.message-list-content\s*\{[^}]*var\(--keyboard-offset/s);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /height:\s*100svh/);
});

test('mobile viewport helper follows visual viewport bottom for keyboard offset', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(source, /visualBottom/);
  assert.match(source, /layoutHeight - visualBottom/);
  assert.match(source, /document\.addEventListener\('focusin'/);
  assert.match(source, /isKeyboardInput/);
  assert.match(source, /requestAnimationFrame/);
});

test('composer textarea resizes in layout effect to avoid typed-frame jumps', () => {
  const source = readFileSync(new URL('../components/InputBar.tsx', import.meta.url), 'utf8');

  assert.match(source, /useLayoutEffect/);
  assert.doesNotMatch(source, /style\.height = '0px'/);
  assert.match(source, /style\.height = 'auto'/);
});
