import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsClient } from '../ws';

test('WsClient runs onOpen handlers for every reconnect', async () => {
  const sent: unknown[] = [];
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (e: { data: string }) => void;
    constructor(readonly url: string) { sockets.push(this); }
    send(raw: string) { sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  }

  const prevWs = (globalThis as any).WebSocket;
  const prevLocation = (globalThis as any).location;
  (globalThis as any).WebSocket = FakeWebSocket;
  (globalThis as any).location = { protocol: 'http:', host: 'localhost:8080' };

  try {
    const client = new WsClient('tok', () => {});
    client.onOpen(() => client.send({ type: 'hello', sessionId: 'sess-1', lastEventId: 7 }));
    client.connect();
    sockets[0].open();
    assert.deepEqual(sent, [{ type: 'hello', sessionId: 'sess-1', lastEventId: 7 }]);

    sockets[0].close();
    await new Promise((resolve) => setTimeout(resolve, 550));
    sockets[1].open();
    assert.deepEqual(sent, [
      { type: 'hello', sessionId: 'sess-1', lastEventId: 7 },
      { type: 'hello', sessionId: 'sess-1', lastEventId: 7 },
    ]);
    client.close();
  } finally {
    (globalThis as any).WebSocket = prevWs;
    (globalThis as any).location = prevLocation;
  }
});
