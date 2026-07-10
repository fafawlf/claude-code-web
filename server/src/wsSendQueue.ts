import type { WebSocket } from 'ws';
import type { ServerAttachmentScope, ServerMessage, ServerSdkEventBatch } from './protocol.js';
import type { SessionEvent } from './session/ClaudeSession.js';
import { boundReplayValue } from './session/ReplayBuffer.js';

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

  send(message: ServerMessage, priority: Priority = priorityForMessage(message), generation?: number): boolean {
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
    if (item.bytes + this.socket.bufferedAmount >= WS_BUFFER_HARD_BYTES) {
      this.failOverloaded();
      return false;
    }
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

export type ReplayBatchBuildOptions = {
  maxBytes?: number;
  signal?: AbortSignal;
  /** Cooperative scheduling budget. Primarily exposed for deterministic tests. */
  maxEventsPerSlice?: number;
  maxSliceMs?: number;
};

/**
 * Build replay frames incrementally. Each SDK event is serialized once for
 * sizing, and construction yields to the event loop between short slices so a
 * large transcript cannot monopolize the server thread.
 */
export async function* buildReplayBatches(
  events: SessionEvent[],
  scope: ServerAttachmentScope,
  options: ReplayBatchBuildOptions | number = {}
): AsyncGenerator<ServerSdkEventBatch, void, void> {
  const normalized = typeof options === 'number' ? { maxBytes: options } : options;
  const maxBytes = normalized.maxBytes ?? WS_REPLAY_FRAME_MAX_BYTES;
  const maxEventsPerSlice = Math.max(1, normalized.maxEventsPerSlice ?? 64);
  const maxSliceMs = Math.max(1, normalized.maxSliceMs ?? 8);
  const signal = normalized.signal;

  const emptyComplete: ServerSdkEventBatch = {
    type: 'sdk_events_batch',
    ...scope,
    events: [],
    replayComplete: true,
  };
  const emptyCompleteBytes = serializedBytes(emptyComplete);
  if (emptyCompleteBytes > maxBytes) {
    throw new RangeError(`Replay scope exceeds frame limit (${emptyCompleteBytes} > ${maxBytes} bytes)`);
  }

  let current: Array<{ id: number; event: unknown }> = [];
  let currentEntriesBytes = 0;
  let pending: ServerSdkEventBatch | undefined;
  let eventsInSlice = 0;
  let sliceStartedAt = performance.now();

  const takeCurrent = (): ServerSdkEventBatch | undefined => {
    if (current.length === 0) return undefined;
    const batch: ServerSdkEventBatch = { type: 'sdk_events_batch', ...scope, events: current };
    current = [];
    currentEntriesBytes = 0;
    return batch;
  };

  for (const entry of events) {
    if (signal?.aborted) return;
    const { wireEntry, bytes: entryBytes } = fitWireEntry(entry, maxBytes - emptyCompleteBytes);
    const candidateBytes = emptyCompleteBytes
      + currentEntriesBytes
      + entryBytes
      + (current.length > 0 ? current.length : 0);

    if (current.length > 0 && candidateBytes > maxBytes) {
      const complete = takeCurrent()!;
      if (pending) {
        yield pending;
        await yieldToEventLoop();
        if (signal?.aborted) return;
        eventsInSlice = 0;
        sliceStartedAt = performance.now();
      }
      pending = complete;
    }
    current.push(wireEntry);
    currentEntriesBytes += entryBytes;

    eventsInSlice += 1;
    if (eventsInSlice >= maxEventsPerSlice || performance.now() - sliceStartedAt >= maxSliceMs) {
      await yieldToEventLoop();
      if (signal?.aborted) return;
      eventsInSlice = 0;
      sliceStartedAt = performance.now();
    }
  }

  const finalCurrent = takeCurrent();
  if (finalCurrent) {
    if (pending) {
      yield pending;
      await yieldToEventLoop();
      if (signal?.aborted) return;
    }
    pending = finalCurrent;
  }
  if (signal?.aborted) return;
  const finalBatch = pending ?? emptyComplete;
  finalBatch.replayComplete = true;
  yield finalBatch;
}

function priorityForMessage(message: ServerMessage): Priority {
  return message.type === 'sdk_event' || message.type === 'sdk_events_batch' ? 'replay' : 'control';
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function fitWireEntry(
  entry: SessionEvent,
  maxEntryBytes: number
): { wireEntry: { id: number; event: unknown }; bytes: number } {
  const make = (event: unknown) => {
    const wireEntry = { id: entry.id, event };
    return { wireEntry, bytes: serializedBytes(wireEntry) };
  };

  let candidate = make(entry.event as unknown);
  if (candidate.bytes <= maxEntryBytes) return candidate;

  // ReplayBuffer already bounds individual strings, but an event containing
  // many large fields can still exceed a transport frame. Preserve as much of
  // its structure as possible before falling back to an explicit placeholder.
  for (const maxStringChars of [8_192, 2_048, 512, 128]) {
    candidate = make(boundReplayValue(entry.event, maxStringChars, true));
    if (candidate.bytes <= maxEntryBytes) return candidate;
  }

  const originalType = isRecord(entry.event) && typeof entry.event.type === 'string'
    ? entry.event.type
    : 'SDK';
  candidate = make({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: `[Historical ${originalType} event omitted because it exceeded the replay frame limit.]`,
      }],
    },
    replayTruncated: true,
    originalType,
  });
  if (candidate.bytes > maxEntryBytes) {
    throw new RangeError(`Replay frame limit is too small for event ${entry.id}`);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
