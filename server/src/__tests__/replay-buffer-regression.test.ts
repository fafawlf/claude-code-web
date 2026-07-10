import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ReplayBuffer, boundReplayValue, estimateReplayBytes } from '../session/ReplayBuffer.js';
import { streamBoundedJsonLines } from '../session/boundedJsonl.js';

test('ReplayBuffer evicts by count and reports sticky truncation', () => {
  const buffer = new ReplayBuffer<{ id: number }>({ maxEvents: 2, maxBytes: 1_000 });
  buffer.push({ id: 1 });
  buffer.push({ id: 2 });
  buffer.push({ id: 3 });

  assert.deepEqual(buffer.toArray(), [{ id: 2 }, { id: 3 }]);
  assert.equal(buffer.truncated, true);
});

test('ReplayBuffer evicts by UTF-8 byte size', () => {
  const buffer = new ReplayBuffer<{ id: number; text: string }>({ maxEvents: 10, maxBytes: 100 });
  buffer.push({ id: 1, text: '你'.repeat(20) });
  buffer.push({ id: 2, text: '好'.repeat(20) });

  assert.ok(buffer.byteLength <= 100);
  assert.equal(buffer.truncated, true);
  assert.deepEqual(buffer.toArray().map((event) => event.id), [2]);
});

test('boundReplayValue caps nested strings and removes base64 payloads', () => {
  const bounded = boundReplayValue({
    content: [{ type: 'text', text: 'x'.repeat(100) }],
    source: { type: 'base64', data: 'secret-binary' },
  }, 16);

  assert.match(bounded.content[0].text, /^x{16}\n\.\.\. \[trimmed 84 chars\]$/);
  assert.equal(bounded.source.data, '[binary omitted]');
  assert.ok(estimateReplayBytes(bounded) < estimateReplayBytes({ text: 'x'.repeat(1_000) }));
});

test('bounded JSONL streaming truncates escaped tokens without breaking JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-bounded-jsonl-'));
  const path = join(dir, 'history.jsonl');
  try {
    await writeFile(path, `${JSON.stringify({
      text: `start\\\"${'x'.repeat(100)}`,
      keep: 42,
    })}\n`);
    const parsed: Array<{ text: string; keep: number }> = [];
    for await (const value of streamBoundedJsonLines<{ text: string; keep: number }>(path, { maxStringBytes: 32 })) {
      parsed.push(value);
    }

    assert.equal(parsed[0]?.keep, 42);
    assert.match(parsed[0]?.text ?? '', /^start\\"x+\.\.\. \[trimmed\]$/);
    assert.ok((parsed[0]?.text.length ?? 100) < 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
