import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsClient } from '../ws';

// Regression: QA-WS-003 — reconnect reused a transcript-only hello instead of the resolved live session.
// Found by /qa on 2026-07-10.
test('setHelloIntent updates reconnect target without reattaching the open socket', async () => {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = FakeWebSocket.CONNECTING;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (e: { data: string }) => void;
    sent: unknown[] = [];
    constructor(readonly url: string) { sockets.push(this); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
    disconnect() { this.readyState = 3; this.onclose?.(); }
    close() { this.disconnect(); }
  }

  const previousWebSocket = (globalThis as any).WebSocket;
  const previousLocation = (globalThis as any).location;
  (globalThis as any).WebSocket = FakeWebSocket;
  (globalThis as any).location = { protocol: 'http:', host: 'localhost:8080' };
  try {
    const client = new WsClient('', () => {});
    client.send({ type: 'hello', resumeClaudeId: 'transcript-1', attachId: 'attach-1' });
    client.connect();
    sockets[0].open();
    assert.equal(sockets[0].sent.length, 1);

    client.setHelloIntent({ type: 'hello', sessionId: 'runtime-1', lastEventId: 15, attachId: 'attach-1' });
    assert.equal(sockets[0].sent.length, 1);
    sockets[0].disconnect();
    await new Promise((resolve) => setTimeout(resolve, 550));
    sockets[1].open();

    assert.deepEqual(sockets[1].sent, [
      { type: 'hello', sessionId: 'runtime-1', lastEventId: 15, attachId: 'attach-1' },
    ]);
    client.close();
  } finally {
    (globalThis as any).WebSocket = previousWebSocket;
    (globalThis as any).location = previousLocation;
  }
});
