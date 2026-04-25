import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeProjectPath, projectName, readPinnedProjects, readRecentProjects, rememberProject, togglePinnedProject, type StorageLike } from '../projectHistory';
import { ProjectLauncher } from '../components/ProjectLauncher';

(globalThis as unknown as { React: typeof React }).React = React;

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('project history records, dedupes, sorts, and limits recent projects', () => {
  const storage = new MemoryStorage();
  for (let i = 0; i < 14; i++) rememberProject(`/root/p${i}`, storage, i);
  rememberProject('/root/p2/', storage, 99);
  const recents = readRecentProjects(storage);

  assert.equal(recents.length, 12);
  assert.equal(recents[0].path, '/root/p2');
  assert.equal(recents[0].lastUsed, 99);
  assert.equal(recents.filter((p) => p.path === '/root/p2').length, 1);
});

test('project pins toggle independently from recents', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(togglePinnedProject('/root/chatgpt', storage), ['/root/chatgpt']);
  assert.deepEqual(readPinnedProjects(storage), ['/root/chatgpt']);
  assert.deepEqual(togglePinnedProject('/root/chatgpt', storage), []);
});

test('project path helpers normalize and label paths', () => {
  assert.equal(normalizeProjectPath('/root/chatgpt/'), '/root/chatgpt');
  assert.equal(normalizeProjectPath('   '), '/');
  assert.equal(projectName('/root/chatgpt'), 'chatgpt');
  assert.equal(projectName('/'), '/');
});

test('ProjectLauncher renders a Finder-style project folder picker', () => {
  const html = renderToStaticMarkup(createElement(ProjectLauncher, {
    token: 't',
    current: '/root/chatgpt',
    recents: [{ path: '/root/other', lastUsed: 2 }],
    pinned: ['/root/pinned'],
    busy: true,
    onClose: () => {},
    onPick: () => {},
    onTogglePin: () => {},
  }));

  assert.match(html, /Choose project folder/);
  assert.match(html, /Project Finder/);
  assert.match(html, /project-launcher/);
  assert.match(html, /Browsing folders on the machine running claudecode-web/);
  assert.match(html, /Current project/);
  assert.match(html, /Pinned/);
  assert.match(html, /Recent/);
  assert.match(html, /New Folder/);
  assert.match(html, /Open folder/);
  assert.match(html, /Current chat will keep working in Activity/);
  assert.doesNotMatch(html, /fixed inset-0/);
  assert.doesNotMatch(html, /Use this folder/);
});
