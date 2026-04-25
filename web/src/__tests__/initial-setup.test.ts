import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InitialSetup } from '../components/InitialSetup';

(globalThis as unknown as { React: typeof React }).React = React;

test('InitialSetup explains local and remote Claude Code modes', () => {
  const html = renderToStaticMarkup(createElement(InitialSetup, {
    cwd: '/Users/me/work/app',
    home: '/Users/me',
    auth: { source: 'account', plan: 'max', label: 'Claude Max', detail: 'claude login' },
    claude: { source: 'path', label: 'claude on PATH', path: '/opt/homebrew/bin/claude' },
    server: { host: '127.0.0.1', port: 8080, platform: 'darwin', arch: 'arm64', node: 'v22.0.0' },
    onDone: () => {},
    onOpenProject: () => {},
  }));

  assert.match(html, /Set up Claude Code Web/);
  assert.match(html, /setup-overlay/);
  assert.match(html, /setup-card/);
  assert.match(html, /setup-body/);
  assert.match(html, /setup-footer/);
  assert.match(html, /Local Claude Code/);
  assert.match(html, /Remote server over SSH/);
  assert.match(html, /folder picker, Bash, and file edits are local/);
  assert.match(html, /folders and commands are remote/);
  assert.match(html, /claude on PATH/);
  assert.match(html, /Claude Max/);
  assert.match(html, /darwin \/ arm64 \/ 127.0.0.1:8080/);
});

test('InitialSetup warns when Claude executable or auth is missing', () => {
  const html = renderToStaticMarkup(createElement(InitialSetup, {
    cwd: '/root/project',
    auth: { source: 'none', label: 'No Claude auth', detail: 'API key or claude login not detected' },
    claude: { source: 'missing', label: 'Claude executable not found', detail: 'Install claude or set CLAUDE_CODE_PATH' },
    onDone: () => {},
    onOpenProject: () => {},
  }));

  assert.match(html, /Claude executable not found/);
  assert.match(html, /Install claude or set CLAUDE_CODE_PATH/);
  assert.match(html, /No Claude auth/);
  assert.match(html, /API key or claude login not detected/);
});
