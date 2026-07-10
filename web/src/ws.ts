import type { ClientHello, ClientMessage, ServerMessage } from './types';
import { appUrl } from './appUrl';

export type WsHandler = (m: ServerMessage) => void;
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';
export type ConnectionHandler = (s: ConnectionState) => void;

export class WsClient {
  private ws?: WebSocket;
  private handler: WsHandler;
  private connHandler?: ConnectionHandler;
  private openHandlers = new Set<() => void>();
  private token: string;
  private closed = false;
  private backoff = 500;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private latestHello?: ClientHello;
  private helloSentOnSocket?: WebSocket;

  constructor(token: string, handler: WsHandler) {
    this.token = token;
    this.handler = handler;
  }

  onConnectionChange(cb: ConnectionHandler): void {
    this.connHandler = cb;
  }

  private emit(state: ConnectionState): void {
    this.connHandler?.(state);
  }

  connect(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.emit(this.ws ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Cookie mode has no token; the session cookie rides the handshake.
    const path = this.token ? `/ws?t=${encodeURIComponent(this.token)}` : '/ws';
    const url = `${proto}://${location.host}${appUrl(path)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try { this.handler(JSON.parse(e.data) as ServerMessage); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.closed) { this.emit('closed'); return; }
      this.emit('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff = 500;
      this.emit('open');
      for (const cb of this.openHandlers) cb();
      // `onOpen` callbacks are kept for backwards compatibility. If none of
      // them sent the current hello, replay the latest attachment intent now.
      // Only hello is retained: user/control messages must never leak into a
      // different session after a reconnect.
      if (this.latestHello && this.helloSentOnSocket !== ws) {
        ws.send(JSON.stringify(this.latestHello));
        this.helloSentOnSocket = ws;
      }
    };
  }

  onOpen(cb: () => void): void {
    this.openHandlers.add(cb);
    if (this.ws?.readyState === WebSocket.OPEN) cb();
  }

  setHelloIntent(hello: ClientHello): void {
    this.latestHello = hello;
  }

  send(m: ClientMessage): boolean {
    if (m.type === 'hello') this.setHelloIntent(m);
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    if (m.type === 'hello') this.helloSentOnSocket = this.ws;
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.emit('closed');
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
