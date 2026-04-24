import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, addUserOptimistic, applyStateDelta, initialState, withReady, type ChatState } from '../reducer';
import type { SdkEvent, SessionStateSnapshot } from '../types';

function baseState(): ChatState {
  const snap: SessionStateSnapshot = {
    sessionId: 'sess-1',
    cwd: '/tmp',
    permissionMode: 'default',
    runtimeStatus: 'idle',
    attachedCount: 0,
    lastEventId: 0,
    lastEventAt: Date.now(),
    tokensIn: 0,
    tokensOut: 0,
  };
  return withReady(initialState, snap);
}

test('stream_event text_delta accumulates streamingText and marks busy', () => {
  let s = baseState();
  for (const chunk of ['Hel', 'lo', ' world']) {
    const ev: SdkEvent = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } },
    } as unknown as SdkEvent;
    s = applyEvent(s, ev, s.lastEventId + 1);
  }
  assert.equal(s.streamingText, 'Hello world');
  assert.equal(s.busy, true);
  assert.equal(s.items.length, 0);
});

test('message_start clears streamingText and sets busy', () => {
  let s = baseState();
  s = { ...s, streamingText: 'stale' };
  const ev: SdkEvent = { type: 'stream_event', event: { type: 'message_start' } } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.streamingText, '');
  assert.equal(s.busy, true);
});

test('final assistant message clears streamingText and appends text/tool_use items', () => {
  let s = baseState();
  s = { ...s, streamingText: 'partial', busy: true };
  const ev: SdkEvent = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Here is the plan.' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.streamingText, '');
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].kind, 'assistant_text');
  assert.equal((s.items[0] as any).text, 'Here is the plan.');
  assert.equal(s.items[1].kind, 'tool_use');
  assert.equal((s.items[1] as any).name, 'Bash');
});

test('local model switch stdout notice is filtered from assistant messages', () => {
  let s = baseState();
  const ev: SdkEvent = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>' },
      ],
    },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 0);
  assert.equal(s.streamingText, '');
});

test('local model switch stdout can be stripped from a mixed assistant message', () => {
  let s = baseState();
  s = {
    ...s,
    streamingText: '<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>\nDone.',
    busy: true,
  };
  const ev: SdkEvent = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>\nDone.' },
      ],
    },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 1);
  assert.equal((s.items[0] as any).text, 'Done.');
  assert.equal((s.items[0] as any).streamed, true);
});

test('user event with text content creates a user ChatItem (regression)', () => {
  let s = baseState();
  const ev: SdkEvent = {
    type: 'user',
    message: { content: [{ type: 'text', text: 'Please rename foo to bar' }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].kind, 'user');
  assert.equal((s.items[0] as any).text, 'Please rename foo to bar');
});

test('user event with string content (not array) also creates user ChatItem', () => {
  let s = baseState();
  const ev: SdkEvent = { type: 'user', message: { content: 'hi there' } } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 1);
  assert.equal((s.items[0] as any).text, 'hi there');
});

test('addUserOptimistic then matching echo absorbs the optimistic item (no duplicate)', () => {
  let s = baseState();
  s = addUserOptimistic(s, 'hello');
  assert.equal(s.items.length, 1);
  assert.equal((s.items[0] as any).optimistic, true);

  const ev: SdkEvent = {
    type: 'user',
    message: { content: [{ type: 'text', text: 'hello' }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 1, 'echo should be absorbed into the optimistic item, not appended');
  assert.equal(s.items[0].kind, 'user');
  assert.equal((s.items[0] as any).optimistic, false);
});

test('mismatched echo does NOT absorb — appends instead', () => {
  let s = baseState();
  s = addUserOptimistic(s, 'original message');
  const ev: SdkEvent = {
    type: 'user',
    message: { content: [{ type: 'text', text: 'different message' }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.items.length, 2);
  assert.equal((s.items[0] as any).text, 'original message');
  assert.equal((s.items[0] as any).optimistic, true);
  assert.equal((s.items[1] as any).text, 'different message');
});

test('tool_result binds back to the matching tool_use by tool_use_id', () => {
  let s = baseState();
  const assistEv: SdkEvent = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu_99', name: 'Bash', input: { command: 'pwd' } }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, assistEv, 1);
  const resultEv: SdkEvent = {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tu_99', content: '/home/user', is_error: false }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, resultEv, 2);
  assert.equal(s.items.length, 1);
  const tu = s.items[0] as any;
  assert.equal(tu.kind, 'tool_use');
  assert.equal(tu.result?.content, '/home/user');
  assert.equal(tu.result?.isError, false);
});

test('tool_result with is_error=true marks the tool_use errored', () => {
  let s = baseState();
  const assistEv: SdkEvent = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu_err', name: 'Bash', input: { command: 'false' } }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, assistEv, 1);
  const resultEv: SdkEvent = {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tu_err', content: 'exit 1', is_error: true }] },
  } as unknown as SdkEvent;
  s = applyEvent(s, resultEv, 2);
  const tu = s.items[0] as any;
  assert.equal(tu.result?.isError, true);
});

test('result event clears busy and streamingText', () => {
  let s = baseState();
  s = { ...s, busy: true, streamingText: 'leftover' };
  const ev: SdkEvent = { type: 'result' } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.busy, false);
  assert.equal(s.streamingText, '');
});

test('history replay order: user text, assistant text, user tool_result, assistant follow-up', () => {
  let s = baseState();
  const seq: SdkEvent[] = [
    { type: 'user', message: { content: [{ type: 'text', text: 'List files' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_A', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'a\nb\n' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'You have 2 files.' }] } },
  ] as unknown as SdkEvent[];
  let id = 0;
  for (const ev of seq) s = applyEvent(s, ev, ++id);

  // Expected items: user("List files"), tool_use(Bash + result), assistant_text("You have 2 files.")
  assert.equal(s.items.length, 3);
  assert.equal(s.items[0].kind, 'user');
  assert.equal((s.items[0] as any).text, 'List files');
  assert.equal(s.items[1].kind, 'tool_use');
  assert.equal((s.items[1] as any).result?.content, 'a\nb\n');
  assert.equal(s.items[2].kind, 'assistant_text');
  assert.equal((s.items[2] as any).text, 'You have 2 files.');
});

test('system error event appends an error item and clears busy', () => {
  let s = baseState();
  s = { ...s, busy: true };
  const ev: SdkEvent = { type: 'system', subtype: 'error', message: 'boom' } as unknown as SdkEvent;
  s = applyEvent(s, ev, 1);
  assert.equal(s.busy, false);
  const last = s.items[s.items.length - 1] as any;
  assert.equal(last.kind, 'system');
  assert.equal(last.level, 'error');
  assert.equal(last.text, 'boom');
});

test('applyStateDelta merges model/mode onto existing state (optimistic update)', () => {
  let s = baseState();
  assert.equal(s.state?.model, undefined);
  s = applyStateDelta(s, { model: 'claude-opus-4-7' });
  assert.equal(s.state?.model, 'claude-opus-4-7');
  s = applyStateDelta(s, { permissionMode: 'plan' });
  assert.equal(s.state?.permissionMode, 'plan');
  assert.equal(s.state?.model, 'claude-opus-4-7'); // prior delta preserved
});

test('applyStateDelta is a no-op before ready (state === null)', () => {
  // A setState prior to hello/ready arriving should not crash or lose items.
  const pre: ChatState = { ...initialState };
  const out = applyStateDelta(pre, { model: 'x' });
  assert.equal(out.state, null);
});

test('applyStateDelta is idempotent when applied twice with same delta', () => {
  let s = baseState();
  s = applyStateDelta(s, { model: 'claude-haiku-4-5' });
  const first = s;
  s = applyStateDelta(s, { model: 'claude-haiku-4-5' });
  assert.deepEqual(s.state, first.state);
});

test('lastEventId always advances to the max id seen', () => {
  let s = baseState();
  s = applyEvent(s, { type: 'result' } as unknown as SdkEvent, 5);
  assert.equal(s.lastEventId, 5);
  s = applyEvent(s, { type: 'result' } as unknown as SdkEvent, 3); // out-of-order
  assert.equal(s.lastEventId, 5);
  s = applyEvent(s, { type: 'result' } as unknown as SdkEvent, 9);
  assert.equal(s.lastEventId, 9);
});
