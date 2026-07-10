import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsClient } from '../ws';

// Regression: QA-WS-001 — session switches were silently dropped while reconnecting.
// Found by /qa on 2026-07-10.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = FakeWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  sent: unknown[] = [];

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  disconnect() {
    this.readyState = 3;
    this.onclose?.();
  }

  close() {
    this.disconnect();
  }
}

let sockets: FakeWebSocket[] = [];

async function withFakeSockets(run: () => Promise<void> | void) {
  sockets = [];
  const previousWebSocket = (globalThis as any).WebSocket;
  const previousLocation = (globalThis as any).location;
  (globalThis as any).WebSocket = FakeWebSocket;
  (globalThis as any).location = { protocol: 'http:', host: 'localhost:8080' };
  try {
    await run();
  } finally {
    (globalThis as any).WebSocket = previousWebSocket;
    (globalThis as any).location = previousLocation;
  }
}

test('WsClient coalesces disconnected hello intents to the latest target', async () => {
  await withFakeSockets(() => {
    const client = new WsClient('token', () => {});
    client.connect();

    assert.equal(client.send({ type: 'hello', sessionId: 'session-a', attachId: 'attach-a' }), false);
    assert.equal(client.send({ type: 'hello', sessionId: 'session-b', attachId: 'attach-b' }), false);
    sockets[0].open();

    assert.deepEqual(sockets[0].sent, [
      { type: 'hello', sessionId: 'session-b', attachId: 'attach-b' },
    ]);
    client.close();
  });
});

test('WsClient never queues ordinary messages across a reconnect', async () => {
  await withFakeSockets(async () => {
    const client = new WsClient('', () => {});
    client.connect();
    client.send({ type: 'hello', sessionId: 'session-a', attachId: 'attach-a' });

    assert.equal(client.send({ type: 'user', text: 'must not leak' }), false);
    sockets[0].open();
    assert.deepEqual(sockets[0].sent, [
      { type: 'hello', sessionId: 'session-a', attachId: 'attach-a' },
    ]);

    sockets[0].disconnect();
    assert.equal(client.send({ type: 'permission_response', reqId: 'old', decision: 'allow' }), false);
    await new Promise((resolve) => setTimeout(resolve, 550));
    sockets[1].open();

    assert.deepEqual(sockets[1].sent, [
      { type: 'hello', sessionId: 'session-a', attachId: 'attach-a' },
    ]);
    client.close();
  });
});

test('WsClient does not duplicate hello when an onOpen callback sends it', async () => {
  await withFakeSockets(() => {
    const client = new WsClient('', () => {});
    client.onOpen(() => client.send({ type: 'hello', sessionId: 'session-a' }));
    client.connect();
    sockets[0].open();

    assert.deepEqual(sockets[0].sent, [{ type: 'hello', sessionId: 'session-a' }]);
    client.close();
  });
});
