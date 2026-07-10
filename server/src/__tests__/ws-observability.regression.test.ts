import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('websocket lifecycle emits structured canary metrics', () => {
  const source = readFileSync(new URL('../ws.ts', import.meta.url), 'utf8');
  for (const event of ['ws_connected', 'ws_attach_complete', 'ws_attach_failed', 'ws_disconnected']) {
    assert.match(source, new RegExp(`event: '${event}'`));
  }
  assert.match(source, /historyLoadMs:/);
  assert.match(source, /historyTruncated:/);
  assert.match(source, /replayEvents:/);
});
