import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelMenu } from '../components/ModelMenu';
import { NodeProviderMenu } from '../components/NodeProviderMenu';
import { modelOptionsForProvider, providerLabel } from '../types';

(globalThis as unknown as { React: typeof React }).React = React;

test('provider helpers expose distinct Claude and Codex model menus', () => {
  assert.equal(providerLabel('codex'), 'Codex');
  assert.ok(modelOptionsForProvider('claude').some((m) => m.id.startsWith('claude-')));
  assert.ok(modelOptionsForProvider('codex').some((m) => m.id.includes('codex')));
});

test('NodeProviderMenu renders the selected node/provider without ssh details', () => {
  const html = renderToStaticMarkup(createElement(NodeProviderMenu, {
    nodes: [
      { id: 'local', label: 'MacBook', kind: 'local', defaultCwd: '/Users/me/code', providers: ['claude', 'codex'], connected: true },
      { id: 'do', label: 'DO', kind: 'ssh', defaultCwd: '/root/app', providers: ['claude'], connected: false },
    ],
    currentNodeId: 'local',
    currentProvider: 'codex',
    onSelect: () => {},
  }));

  assert.match(html, /MacBook/);
  assert.match(html, /Codex/);
  assert.doesNotMatch(html, /user@/);
});

test('ModelMenu switches labels by provider', () => {
  const claude = renderToStaticMarkup(createElement(ModelMenu, {
    current: undefined,
    provider: 'claude',
    onSelect: () => {},
  }));
  const codex = renderToStaticMarkup(createElement(ModelMenu, {
    current: undefined,
    provider: 'codex',
    onSelect: () => {},
  }));

  assert.match(claude, /default/);
  assert.match(codex, /Codex default/);
});
