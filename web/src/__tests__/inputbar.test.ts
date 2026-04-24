import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InputBar } from '../components/InputBar';

(globalThis as unknown as { React: typeof React }).React = React;

test('InputBar exposes plan mode as a bottom toggle', () => {
  const html = renderToStaticMarkup(createElement(InputBar, {
    token: 't',
    cwd: '/tmp',
    mode: 'plan',
    busy: false,
    ready: true,
    onSend: () => {},
    onStop: () => {},
    onSlashAction: () => {},
    onCycleMode: () => {},
    onSetMode: () => {},
  }));

  assert.match(html, /Toggle plan mode/);
  assert.match(html, /Upload file or image/);
  assert.match(html, />Attach</);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />Plan mode</);
  assert.match(html, />Permissions</);
});

test('InputBar keeps bypass permissions visible in the bottom mode controls', () => {
  const html = renderToStaticMarkup(createElement(InputBar, {
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

  assert.match(html, /Permission mode: bypass permissions/);
  assert.match(html, />Bypass</);
  assert.match(html, /aria-pressed="false"/);
});
