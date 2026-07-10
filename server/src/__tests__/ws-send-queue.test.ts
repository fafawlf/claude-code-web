import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerMessage } from '../protocol.js';
import type { SessionEvent } from '../session/ClaudeSession.js';
import {
  buildReplayBatches,
  WS_BUFFER_HARD_BYTES,
  WS_BUFFER_SOFT_BYTES,
  WS_REPLAY_FRAME_MAX_BYTES,
  WsSendQueue,
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

test('replay batching stays under 256 KiB and marks only the final batch complete', () => {
  const events: SessionEvent[] = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    event: { type: 'assistant', content: 'x'.repeat(48 * 1024) },
  })) as SessionEvent[];
  const batches = buildReplayBatches(events, { attachId: 'a', sessionId: 's' });

  assert.ok(batches.length > 1);
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= WS_REPLAY_FRAME_MAX_BYTES);
  }
  assert.equal(batches.slice(0, -1).some((batch) => batch.replayComplete === true), false);
  assert.equal(batches.at(-1)?.replayComplete, true);
  assert.deepEqual(batches.flatMap((batch) => batch.events).map((event) => event.id),
    Array.from({ length: 12 }, (_, index) => index + 1));
});

test('empty replay still emits an explicit completion batch', () => {
  const [batch] = buildReplayBatches([], { attachId: 'a', sessionId: 's' });
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

test('hard backpressure watermark closes the socket with retry-later code', () => {
  const socket = new FakeSocket();
  socket.bufferedAmount = WS_BUFFER_HARD_BYTES;
  const writer = new WsSendQueue(socket);

  assert.equal(writer.send({ type: 'heartbeat', now: 1 }), false);
  assert.equal(socket.closed?.code, 1013);
});
