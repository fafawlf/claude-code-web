import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, applyEventBatch, initialState } from '../reducer';
import type { SdkEvent } from '../types';

// Regression: QA-REPLAY-001 — reopening a transcript appended the same history again.
// Found by /qa on 2026-07-10.
const userEvent = (text: string): SdkEvent => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
});

test('applyEvent ignores an event id already represented by the chat state', () => {
  const once = applyEvent(initialState, userEvent('hello'), 10);
  const duplicate = applyEvent(once, userEvent('hello'), 10);
  const older = applyEvent(once, userEvent('older replay'), 9);

  assert.strictEqual(duplicate, once);
  assert.strictEqual(older, once);
  assert.equal(once.items.length, 1);
});

test('applyEventBatch appends only the unseen suffix in one state result', () => {
  const cached = applyEvent(initialState, userEvent('cached'), 5);
  const next = applyEventBatch(cached, [
    { id: 4, event: userEvent('old') },
    { id: 5, event: userEvent('duplicate') },
    { id: 6, event: userEvent('new') },
  ]);

  assert.deepEqual(next.items.map((item) => item.kind === 'user' ? item.text : ''), ['cached', 'new']);
  assert.equal(next.lastEventId, 6);
});

test('stream deltas do not clone stable transcript history', () => {
  const withHistory = applyEvent(initialState, userEvent('cached'), 1);
  const streamed = applyEvent(withHistory, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
  }, 2);

  assert.strictEqual(streamed.items, withHistory.items);
  assert.equal(streamed.streamingText, 'a');
});
