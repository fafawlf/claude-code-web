import type { ClientMessage, ServerMessage } from './types';

export type WsHandler = (m: ServerMessage) => void;

export class WsClient {
  private ws?: WebSocket;
  private handler: WsHandler;
  private token: string;
  private closed = false;
  private backoff = 500;

  constructor(token: string, handler: WsHandler) {
    this.token = token;
    this.handler = handler;
  }

  connect(): void {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?t=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try { this.handler(JSON.parse(e.data) as ServerMessage); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
    ws.onopen = () => { this.backoff = 500; };
  }

  onOpen(cb: () => void): void {
    const check = () => {
      if (this.ws?.readyState === WebSocket.OPEN) cb();
      else setTimeout(check, 50);
    };
    check();
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
