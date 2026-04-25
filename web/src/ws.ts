import type { ClientMessage, ServerMessage } from './types';
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
    this.emit(this.ws ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${appUrl(`/ws?t=${encodeURIComponent(this.token)}`)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try { this.handler(JSON.parse(e.data) as ServerMessage); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (this.closed) { this.emit('closed'); return; }
      this.emit('reconnecting');
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
    ws.onopen = () => {
      this.backoff = 500;
      this.emit('open');
      for (const cb of this.openHandlers) cb();
    };
  }

  onOpen(cb: () => void): void {
    this.openHandlers.add(cb);
    if (this.ws?.readyState === WebSocket.OPEN) cb();
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.emit('closed');
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
