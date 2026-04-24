import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStableMarkdown } from '../streaming';
import { applyEvent, initialState } from '../reducer';
import type { SdkEvent } from '../types';
import { deriveStatus } from '../components/StatusBar';

test('splitStableMarkdown keeps incomplete fenced code in a live tail', () => {
  const split = splitStableMarkdown('Intro\n\n```ts\nconst x = 1;');
  assert.equal(split.stable, 'Intro\n\n');
  assert.equal(split.tail, '```ts\nconst x = 1;');
});

test('splitStableMarkdown keeps in-progress list and table blocks out of stable markdown', () => {
  const list = splitStableMarkdown('Done paragraph.\n\n- first\n- sec');
  assert.equal(list.stable, 'Done paragraph.\n\n');
  assert.equal(list.tail, '- first\n- sec');

  const table = splitStableMarkdown('Intro\n\n| A | B |\n| - | - |\n| 1 |');
  assert.equal(table.stable, 'Intro\n\n');
  assert.equal(table.tail, '| A | B |\n| - | - |\n| 1 |');
});

test('final assistant message matching streaming text is marked as streamed handoff', () => {
  let s = { ...initialState, streamingText: 'Final answer', busy: true };
  const ev: SdkEvent = { type: 'assistant', message: { content: [{ type: 'text', text: 'Final answer' }] } } as SdkEvent;
  s = applyEvent(s, ev, 1);
  const item = s.items[0];
  assert.equal(item.kind, 'assistant_text');
  assert.equal((item as any).streamed, true);
});

test('StatusBar writing state is human-readable and not character-count based', () => {
  const status = deriveStatus({
    connection: 'open',
    busy: true,
    streamingText: 'hello world',
    items: [],
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 0,
  });
  assert.deepEqual(status, { kind: 'writing' });
});

test('StatusBar reports active tools separately from Claude thinking stalls', () => {
  const status = deriveStatus({
    connection: 'open',
    busy: true,
    streamingText: '',
    items: [{ kind: 'tool_use', id: 'x', toolUseId: 'tu', name: 'Bash', input: { command: 'sleep 99' } }],
    activeTool: { toolUseId: 'tu', name: 'Bash', startedAt: Date.now(), inputSummary: 'sleep 99' },
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 31,
  });
  assert.deepEqual(status, { kind: 'running-tool', name: 'Bash', seconds: 31, inputSummary: 'sleep 99' });
});

test('StatusBar reports no-output thinking when no tool is active', () => {
  const status = deriveStatus({
    connection: 'open',
    busy: true,
    streamingText: '',
    items: [],
    hasPermReq: false,
    pendingEditCount: 0,
    hasPlan: false,
    secondsSinceLastEvent: 31,
  });
  assert.deepEqual(status, { kind: 'stalled', seconds: 31 });
});
