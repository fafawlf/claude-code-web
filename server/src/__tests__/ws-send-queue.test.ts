import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerAttachmentScope, ServerMessage, ServerSdkEventBatch } from '../protocol.js';
import type { SessionEvent } from '../session/ClaudeSession.js';
import {
  buildReplayBatches,
  WS_BUFFER_HARD_BYTES,
  WS_BUFFER_SOFT_BYTES,
  WS_REPLAY_FRAME_MAX_BYTES,
  WsSendQueue,
  type ReplayBatchBuildOptions,
  type WsLike,
} from '../wsSendQueue.js';

class FakeSocket implements WsLike {
  readonly OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  sent: ServerMessage[] = [];
  closed?: { code?: number; reason?: string | Buffer };

  send(data: string | Buffer | ArrayBuffer | Buffer[], cb?: (err?: Error) => void): void {
    this.sent.push(JSON.parse(data.toString()) as ServerMessage);
    cb?.();
  }

  close(code?: number, reason?: string | Buffer): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectReplayBatches(
  events: SessionEvent[],
  scope: ServerAttachmentScope,
  options?: ReplayBatchBuildOptions
): Promise<ServerSdkEventBatch[]> {
  const batches: ServerSdkEventBatch[] = [];
  for await (const batch of buildReplayBatches(events, scope, options)) batches.push(batch);
  return batches;
}

test('replay batching stays under 256 KiB and marks only the final batch complete', async () => {
  const events: SessionEvent[] = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    event: { type: 'assistant', content: 'x'.repeat(48 * 1024) },
  })) as SessionEvent[];
  const batches = await collectReplayBatches(events, { attachId: 'a', sessionId: 's' });

  assert.ok(batches.length > 1);
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= WS_REPLAY_FRAME_MAX_BYTES);
  }
  assert.equal(batches.slice(0, -1).some((batch) => batch.replayComplete === true), false);
  assert.equal(batches.at(-1)?.replayComplete, true);
  assert.deepEqual(batches.flatMap((batch) => batch.events).map((event) => event.id),
    Array.from({ length: 12 }, (_, index) => index + 1));
});

test('empty replay still emits an explicit completion batch', async () => {
  const [batch] = await collectReplayBatches([], { attachId: 'a', sessionId: 's' });
  assert.deepEqual(batch, {
    type: 'sdk_events_batch',
    attachId: 'a',
    sessionId: 's',
    events: [],
    replayComplete: true,
  });
});

test('control frames drain before queued replay and cancelled generations disappear', async () => {
  const socket = new FakeSocket();
  socket.bufferedAmount = WS_BUFFER_SOFT_BYTES;
  const writer = new WsSendQueue(socket);

  writer.send({ type: 'sdk_events_batch', events: [{ id: 1, event: {} }] }, 'replay', 1);
  writer.send({ type: 'heartbeat', now: 2 }, 'control', 2);
  writer.send({ type: 'sdk_events_batch', events: [{ id: 3, event: {} }] }, 'replay', 2);
  writer.cancelGeneration(1);
  socket.bufferedAmount = 0;
  await sleep(25);

  assert.deepEqual(socket.sent.map((message) => message.type), ['heartbeat', 'sdk_events_batch']);
  assert.equal(socket.sent.some((message) => message.type === 'sdk_events_batch' && message.events[0]?.id === 1), false);
  writer.close();
});

test('slow connections keep live SDK events behind replay while control frames stay prioritized', async () => {
  const socket = new FakeSocket();
  socket.bufferedAmount = WS_BUFFER_SOFT_BYTES;
  const writer = new WsSendQueue(socket);

  writer.send({
    type: 'sdk_events_batch',
    events: [{ id: 1, event: { type: 'assistant', content: 'history' } }],
  }, 'replay', 1);
  // This mirrors ws.ts, where a live event currently relies on the default
  // priority. It must share replay's FIFO lane rather than leapfrog history.
  writer.send({ type: 'sdk_event', id: 2, event: { type: 'assistant', content: 'live' } }, undefined, 1);
  writer.send({ type: 'heartbeat', now: 3 }, 'control', 1);

  socket.bufferedAmount = 0;
  await sleep(25);

  assert.deepEqual(socket.sent.map((message) => message.type), [
    'heartbeat',
    'sdk_events_batch',
    'sdk_event',
  ]);
  writer.close();
});

test('building 5000 replay events yields often enough to keep event-loop gaps below 25 ms', async () => {
  const events: SessionEvent[] = Array.from({ length: 5_000 }, (_, index) => ({
    id: index + 1,
    event: { type: 'assistant', content: `event-${index}-${'x'.repeat(48)}` },
  })) as SessionEvent[];
  const batches: ServerSdkEventBatch[] = [];
  let monitoring = true;
  let maxGapMs = 0;
  let lastTick = performance.now();
  const monitor = (async () => {
    while (monitoring) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - lastTick);
      lastTick = now;
    }
  })();

  await new Promise<void>((resolve) => setImmediate(resolve));
  for await (const batch of buildReplayBatches(events, { attachId: 'perf', sessionId: 'large' })) {
    batches.push(batch);
  }
  monitoring = false;
  await monitor;

  assert.ok(maxGapMs < 25, `largest event-loop gap was ${maxGapMs.toFixed(1)} ms`);
  assert.equal(batches.flatMap((batch) => batch.events).length, events.length);
  assert.equal(batches.at(-1)?.replayComplete, true);
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= WS_REPLAY_FRAME_MAX_BYTES);
  }
});

test('replay construction stops without a completion frame when its attachment is aborted', async () => {
  const events: SessionEvent[] = Array.from({ length: 5_000 }, (_, index) => ({
    id: index + 1,
    event: { type: 'assistant', content: `event-${index}` },
  })) as SessionEvent[];
  const controller = new AbortController();
  const abort = setImmediate(() => controller.abort());

  const batches = await collectReplayBatches(events, { attachId: 'cancel', sessionId: 'large' }, {
    signal: controller.signal,
    maxEventsPerSlice: 1,
  });
  clearImmediate(abort);

  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(batches, []);
});

test('an individually oversized event is represented without exceeding the replay frame cap', async () => {
  const batches = await collectReplayBatches([{
    id: 1,
    event: {
      type: 'assistant',
      message: {
        content: Array.from({ length: 40 }, (_, index) => ({
          type: 'text',
          text: `${index}:${'你'.repeat(16 * 1024)}`,
        })),
      },
    },
  } as SessionEvent], { attachId: 'oversized', sessionId: 'large' });

  assert.equal(batches.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(batches[0])) <= WS_REPLAY_FRAME_MAX_BYTES);
  assert.equal(batches[0]?.replayComplete, true);
});

test('hard backpressure watermark closes the socket with retry-later code', () => {
  const socket = new FakeSocket();
  socket.bufferedAmount = WS_BUFFER_HARD_BYTES;
  const writer = new WsSendQueue(socket);

  assert.equal(writer.send({ type: 'heartbeat', now: 1 }), false);
  assert.equal(socket.closed?.code, 1013);
});
