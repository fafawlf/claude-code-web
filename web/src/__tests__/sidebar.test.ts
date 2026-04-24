import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../components/Sidebar';
import type { ActivitySessionViewModel, ActivitySummary } from '../activity';

(globalThis as unknown as { React: typeof React }).React = React;

const summary: ActivitySummary = {
  total: 1,
  label: '1 needs review',
  tone: 'warning',
  needsReviewCount: 1,
  workingCount: 0,
  issueCount: 0,
  finishedCount: 0,
};

const activity: ActivitySessionViewModel[] = [{
  sessionId: 'web-session-1',
  title: 'Fix checkout auth flow',
  subtitle: '~/repo · 2m ago',
  status: 'needs_review',
  statusLabel: 'Needs approval',
  tone: 'warning',
  lastEventAt: 1,
}];

test('sidebar renders Activity badge instead of a Running session list', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/repo',
    projects: [{ path: '/root/repo', lastUsed: 1 }],
    projectSessions: { '/root/repo': [] },
    activeId: null,
    activeSession: null,
    activeDraftTitle: undefined,
    activitySummary: summary,
    activitySessions: activity,
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

  assert.match(html, /Activity/);
  assert.match(html, /1 needs review/);
  assert.doesNotMatch(html, />Running</);
  assert.doesNotMatch(html, /#web-session/);
});

test('sidebar renders Codex-style projects with chats under folders', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/chatgpt',
    projects: [
      { path: '/root/chatgpt', lastUsed: 10 },
      { path: '/root/onion', lastUsed: 9 },
    ],
    projectSessions: {
      '/root/chatgpt': [
        { sessionId: 's1', customTitle: 'Review auth flow notes', lastModified: Date.now() - 17 * 60 * 60 * 1000 },
      ],
      '/root/onion': [],
    },
    activeId: 's1',
    activeSession: null,
    activeDraftTitle: undefined,
    activitySummary: { ...summary, total: 0, label: '', needsReviewCount: 0 },
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

  assert.match(html, />Projects</);
  assert.match(html, />chatgpt</);
  assert.match(html, />onion</);
  assert.match(html, /Review auth flow notes/);
  assert.match(html, />No chats</);
  assert.doesNotMatch(html, />History</);
});

test('sidebar shows the current unsaved chat under its project', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/random shit',
    projects: [{ path: '/root/random shit', lastUsed: 10 }],
    projectSessions: { '/root/random shit': [] },
    activeId: null,
    activeSession: {
      sessionId: 'live-random',
      cwd: '/root/random shit',
      permissionMode: 'default',
      runtimeStatus: 'idle',
      attachedCount: 1,
      lastEventId: 0,
      lastEventAt: Date.now(),
      tokensIn: 0,
      tokensOut: 0,
    },
    activeDraftTitle: undefined,
    activitySummary: { ...summary, total: 0, label: '', needsReviewCount: 0 },
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

  assert.match(html, />random shit</);
  assert.match(html, />New chat</);
  assert.match(html, />draft</);
  assert.doesNotMatch(html, />No chats</);
  assert.doesNotMatch(html, /live-random/);
});

test('sidebar exposes Emochi brand shell when Emochi skin is active', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/repo',
    projects: [{ path: '/root/repo', lastUsed: 1 }],
    projectSessions: { '/root/repo': [] },
    activeId: null,
    activeSession: null,
    activeDraftTitle: undefined,
    activitySummary: { ...summary, total: 0, label: '', needsReviewCount: 0 },
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
    skin: 'emochi',
  }));

  assert.match(html, /Mochi/);
  assert.match(html, /\/assets\/emochi_logo\.png/);
  assert.match(html, /skin-sidebar-emochi/);
});

test('sidebar exposes DevChat logo shell when WeChat skin is active', () => {
  const html = renderToStaticMarkup(createElement(Sidebar, {
    cwd: '/root/repo',
    projects: [{ path: '/root/repo', lastUsed: 1 }],
    projectSessions: { '/root/repo': [] },
    activeId: null,
    activeSession: null,
    activeDraftTitle: undefined,
    activitySummary: { ...summary, total: 0, label: '', needsReviewCount: 0 },
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
    skin: 'wechat',
  }));

  assert.match(html, /Dev/);
  assert.match(html, /\/assets\/wechat_logo\.svg/);
  assert.match(html, /skin-sidebar-wechat/);
});
