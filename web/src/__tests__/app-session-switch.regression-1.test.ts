import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: QA-ATTACH-002 — switching cleared the selected chat and leaked scroll/stream UI state.
// Found by /qa on 2026-07-10.
test('App keeps a target attachment visible until replay completes', async () => {
  const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(source, /type AttachmentViewState/);
  assert.match(source, /phase: 'connecting'/);
  assert.match(source, /phase: 'replaying'/);
  assert.match(source, /m\.replayComplete/);
  assert.match(source, /replayStateRef\.current = applyEventBatch/);
  assert.match(source, /key=\{attachment\.displaySessionKey\}/);
  assert.match(source, /attachment\.phase === 'ready'/);
  assert.match(source, /Syncing…/);
});

test('App websocket lifecycle is independent from toast and chat renders', async () => {
  const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(source, /new WsClient\(token \?\? '', \(message\) => serverMessageHandlerRef\.current\(message\)\)/);
  assert.match(source, /\}, \[authed, nodes\.length, nodesLoaded, token\]\);/);
  assert.doesNotMatch(source, /\[authed[^\]]*pushToast[^\]]*\]/);
});

test('idle transcript timer and session scroll state are isolated', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  const list = await readFile(new URL('../components/MessageList.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(!state\.busy\)/);
  assert.match(app, /scrollPositions=\{scrollPositionsRef\.current\}/);
  assert.match(list, /scrollPositions\.get\(sessionKey\)/);
  assert.match(list, /scrollPositions\.set\(sessionKey, sticky \? 'bottom' : el\.scrollTop\)/);
  assert.match(list, /const Bubble = memo/);
});
