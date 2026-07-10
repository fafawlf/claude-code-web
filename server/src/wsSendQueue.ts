import type { WebSocket } from 'ws';
import type { ServerAttachmentScope, ServerMessage, ServerSdkEventBatch } from './protocol.js';
import type { SessionEvent } from './session/ClaudeSession.js';

export const WS_REPLAY_FRAME_MAX_BYTES = 256 * 1024;
export const WS_BUFFER_SOFT_BYTES = 1024 * 1024;
export const WS_BUFFER_HARD_BYTES = 8 * 1024 * 1024;

type Priority = 'control' | 'replay';
type QueueItem = {
  payload: string;
  bytes: number;
  priority: Priority;
  generation?: number;
};

export type WsLike = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'send' | 'close'> & {
  readonly OPEN: number;
};

/**
 * A small per-socket writer that keeps replay traffic from burying control
 * frames. Queued frames from a superseded attachment can be discarded by
 * generation; frames already accepted by ws cannot be recalled.
 */
export class WsSendQueue {
  private control: QueueItem[] = [];
  private replay: QueueItem[] = [];
  private queuedBytes = 0;
  private drainTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly socket: WsLike) {}

  send(message: ServerMessage, priority: Priority = 'control', generation?: number): boolean {
    if (this.stopped || this.socket.readyState !== this.socket.OPEN) return false;
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch {
      return false;
    }
    const item: QueueItem = {
      payload,
      bytes: Buffer.byteLength(payload),
      priority,
      generation,
    };

    if (this.socket.bufferedAmount >= WS_BUFFER_HARD_BYTES) {
      this.failOverloaded();
      return false;
    }

    const hasQueuedTraffic = this.control.length > 0 || this.replay.length > 0;
    if (!hasQueuedTraffic && this.socket.bufferedAmount < WS_BUFFER_SOFT_BYTES) {
      return this.sendNow(item);
    }

    const queue = priority === 'control' ? this.control : this.replay;
    queue.push(item);
    this.queuedBytes += item.bytes;
    if (this.queuedBytes + this.socket.bufferedAmount >= WS_BUFFER_HARD_BYTES) {
      this.failOverloaded();
      return false;
    }
    this.scheduleDrain();
    return true;
  }

  cancelGeneration(generation: number): void {
    this.control = this.removeGeneration(this.control, generation);
    this.replay = this.removeGeneration(this.replay, generation);
  }

  close(): void {
    this.stopped = true;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
    this.control = [];
    this.replay = [];
    this.queuedBytes = 0;
  }

  private removeGeneration(queue: QueueItem[], generation: number): QueueItem[] {
    const kept: QueueItem[] = [];
    for (const item of queue) {
      if (item.generation === generation) this.queuedBytes -= item.bytes;
      else kept.push(item);
    }
    return kept;
  }

  private sendNow(item: QueueItem): boolean {
    try {
      this.socket.send(item.payload);
      return true;
    } catch {
      return false;
    }
  }

  private drain = (): void => {
    this.drainTimer = undefined;
    if (this.stopped || this.socket.readyState !== this.socket.OPEN) return;
    if (this.socket.bufferedAmount >= WS_BUFFER_HARD_BYTES) {
      this.failOverloaded();
      return;
    }
    while (this.socket.bufferedAmount < WS_BUFFER_SOFT_BYTES) {
      const item = this.control.shift() ?? this.replay.shift();
      if (!item) return;
      this.queuedBytes -= item.bytes;
      if (!this.sendNow(item)) return;
    }
    if (this.control.length > 0 || this.replay.length > 0) this.scheduleDrain();
  };

  private scheduleDrain(): void {
    if (this.drainTimer || this.stopped) return;
    this.drainTimer = setTimeout(this.drain, 10);
    this.drainTimer.unref?.();
  }

  private failOverloaded(): void {
    this.close();
    try { this.socket.close(1013, 'WebSocket backpressure limit exceeded'); } catch { /* best effort */ }
  }
}

/** Build replay batches close to, but normally never above, the transport cap.
 * A single SDK event is indivisible in the current backwards-compatible wire
 * protocol; an individually oversized event is therefore emitted alone rather
 * than silently dropping or corrupting transcript content. */
export function buildReplayBatches(
  events: SessionEvent[],
  scope: ServerAttachmentScope,
  maxBytes = WS_REPLAY_FRAME_MAX_BYTES
): ServerSdkEventBatch[] {
  const batches: ServerSdkEventBatch[] = [];
  let current: Array<{ id: number; event: unknown }> = [];

  const flush = () => {
    if (current.length === 0) return;
    batches.push({ type: 'sdk_events_batch', ...scope, events: current });
    current = [];
  };

  for (const entry of events) {
    const wireEntry = { id: entry.id, event: entry.event as unknown };
    const candidate: ServerSdkEventBatch = {
      type: 'sdk_events_batch',
      ...scope,
      events: [...current, wireEntry],
      // Account for the largest form of the final frame while sizing.
      replayComplete: true,
    };
    if (current.length > 0 && Buffer.byteLength(JSON.stringify(candidate)) > maxBytes) flush();
    current.push(wireEntry);
    const single: ServerSdkEventBatch = {
      type: 'sdk_events_batch',
      ...scope,
      events: current,
      replayComplete: true,
    };
    if (current.length === 1 && Buffer.byteLength(JSON.stringify(single)) > maxBytes) flush();
  }
  flush();
  if (batches.length === 0) batches.push({ type: 'sdk_events_batch', ...scope, events: [] });
  batches[batches.length - 1]!.replayComplete = true;
  return batches;
}
