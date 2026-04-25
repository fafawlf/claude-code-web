import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SKIN, readSkin, SKINS, skinById, writeSkin, type SkinStorageLike } from '../skins';
import { contentForSkin, statusCopyForSkin } from '../skinContent';
import { SkinMenu } from '../components/SkinMenu';
import { EmptyState } from '../components/EmptyState';
import { StatusBar, type StatusKind } from '../components/StatusBar';
import { MessageList } from '../components/MessageList';

(globalThis as unknown as { React: typeof React }).React = React;

class MemoryStorage implements SkinStorageLike {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('skin presets include the imported visual directions', () => {
  assert.deepEqual(SKINS.map((s) => s.id), ['warm', 'cyberpunk', 'wechat', 'catgirl', 'emochi']);
  assert.equal(skinById('cyberpunk').label, 'Cyberpunk');
  assert.equal(skinById('wechat').label, 'DevChat');
  assert.equal(skinById('catgirl').label, 'Catgirl');
  assert.equal(skinById('emochi').label, 'Emochi');
});

test('every skin exposes complete content and status copy', () => {
  const statuses: StatusKind[] = [
    { kind: 'connection-lost' },
    { kind: 'reconnecting' },
    { kind: 'plan-approval' },
    { kind: 'approval-needed', count: 2 },
    { kind: 'running-tool', name: 'Bash', seconds: 9, inputSummary: 'npm test' },
    { kind: 'writing' },
    { kind: 'thinking' },
    { kind: 'stalled', seconds: 21 },
  ];

  for (const skin of SKINS) {
    const content = contentForSkin(skin.id);
    assert.ok(content.empty.headline);
    assert.ok(content.message.thoughtSummary);
    for (const status of statuses) {
      assert.ok(statusCopyForSkin(skin.id, status).label);
    }
  }
});

test('skin storage validates persisted ids', () => {
  const storage = new MemoryStorage();
  assert.equal(readSkin(storage), DEFAULT_SKIN);
  assert.equal(writeSkin('wechat', storage), 'wechat');
  assert.equal(readSkin(storage), 'wechat');

  storage.setItem('ccw_skin', 'unknown');
  assert.equal(readSkin(storage), DEFAULT_SKIN);
});

test('SkinMenu renders the active skin picker button', () => {
  const html = renderToStaticMarkup(createElement(SkinMenu, {
    current: 'catgirl',
    onSelect: () => {},
  }));

  assert.match(html, /Catgirl/);
  assert.match(html, /Change skin/);
  assert.doesNotMatch(html, /Cyberpunk/);
});

test('EmptyState renders skin-specific personality without example prompt cards', () => {
  const cyber = renderToStaticMarkup(createElement(EmptyState, {
    skin: 'cyberpunk',
    cwd: '/root/app',
    onOpenProject: () => {},
  }));
  const cat = renderToStaticMarkup(createElement(EmptyState, {
    skin: 'catgirl',
    cwd: '/root/app',
    onOpenProject: () => {},
  }));
  const wechat = renderToStaticMarkup(createElement(EmptyState, {
    skin: 'wechat',
    cwd: '/root/app',
    onOpenProject: () => {},
  }));
  const emochi = renderToStaticMarkup(createElement(EmptyState, {
    skin: 'emochi',
    cwd: '/root/app',
    onOpenProject: () => {},
  }));

  assert.match(cyber, /JACK IN/);
  assert.match(cat, /主人/);
  assert.match(wechat, /DevChat 已连接/);
  assert.match(wechat, /\/assets\/wechat_logo\.svg/);
  assert.match(emochi, /Hi, I&#x27;m Mochi/);
  assert.match(emochi, /\/assets\/emochi_logo\.png/);
  assert.doesNotMatch(cyber + cat + wechat + emochi, /skin-suggestion/);
});

test('StatusBar uses skin-specific thinking copy without losing controls', () => {
  const thinking = renderToStaticMarkup(createElement(StatusBar, {
    skin: 'catgirl',
    connection: 'open',
    busy: true,
    streamingText: '',
    items: [],
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 3,
  }));
  assert.match(thinking, /喵酱正在想/);

  const mochiThinking = renderToStaticMarkup(createElement(StatusBar, {
    skin: 'emochi',
    connection: 'open',
    busy: true,
    streamingText: '',
    items: [],
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 3,
  }));
  assert.match(mochiThinking, /Mochi is thinking/);

  const running = renderToStaticMarkup(createElement(StatusBar, {
    skin: 'cyberpunk',
    connection: 'open',
    busy: true,
    streamingText: '',
    items: [],
    activeTool: { toolUseId: 'tu', name: 'Bash', startedAt: 1, inputSummary: 'npm test' },
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 12,
    onStop: () => {},
  }));
  assert.match(running, /RUNNING BASH/);
  assert.match(running, /KILL/);
});

test('MessageList skin bubbles keep markdown artifact links', () => {
  const html = renderToStaticMarkup(createElement(MessageList, {
    token: 'tok',
    cwd: '/root/chatgpt',
    skin: 'wechat',
    items: [
      { kind: 'user', id: 'u1', text: 'make a report' },
      { kind: 'assistant_text', id: 'a1', text: 'Done: .claudecode-web/uploads/2026-04-24/report.docx' },
    ],
    busy: false,
    streamingText: '',
    pendingByToolUseId: new Map(),
    secondsSinceLastEvent: 0,
    onAcceptEdit: () => {},
    onRejectEdit: () => {},
    onStop: () => {},
  }));

  assert.match(html, /skin-message-wechat/);
  assert.match(html, /Download/);
  assert.match(html, /\/api\/file\?t=tok/);
});
