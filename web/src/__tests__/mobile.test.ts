import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopBar } from '../components/TopBar';
import { MessageList } from '../components/MessageList';

(globalThis as unknown as { React: typeof React }).React = React;

test('TopBar exposes a mobile projects drawer trigger without replacing project picker', () => {
  const html = renderToStaticMarkup(createElement(TopBar, {
    state: null,
    cwd: '/root/random shit',
    auth: { source: 'api', plan: null, label: 'API', detail: 'ANTHROPIC_API_KEY' },
    onOpenSidebar: () => {},
    onOpenProject: () => {},
    onSelectModel: () => {},
    skin: 'warm',
    onSelectSkin: () => {},
    onRename: () => {},
    connected: true,
  }));

  assert.match(html, /mobile-sidebar-button/);
  assert.match(html, /Open projects/);
  assert.match(html, /Open command|Change skin|API/);
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
