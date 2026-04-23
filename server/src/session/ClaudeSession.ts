import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PermissionBroker } from '../permissions/PermissionBroker.js';

export type SessionEvent = { id: number; event: SDKMessage };
export type EventListener = (ev: SessionEvent) => void;
export type PermissionListener = (req: {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}) => boolean;

type Pending = { resolve: (v: IteratorResult<SDKUserMessage>) => void };

/**
 * Async-iterable queue fed by sendUser(). The SDK pulls from this; we push.
 * Closed by close() which drives the generator to completion.
 */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiters: Pending[] = [];
  private done = false;

  push(text: string): void {
    if (this.done) return;
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
    const w = this.waiters.shift();
    if (w) w.resolve({ value: msg, done: false });
    else this.queue.push(msg);
  }

  close(): void {
    this.done = true;
    while (this.waiters.length) {
      const w = this.waiters.shift()!;
      w.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          const q = this.queue.shift();
          if (q) return resolve({ value: q, done: false });
          if (this.done) return resolve({ value: undefined as unknown as SDKUserMessage, done: true });
          this.waiters.push({ resolve });
        }),
      return: async () => {
        this.close();
        return { value: undefined as unknown as SDKUserMessage, done: true };
      },
    };
  }
}

const RING_CAPACITY = 500;

export class ClaudeSession {
  readonly id: string; // our id; becomes the Claude session id once known
  private claudeSessionId?: string;
  private prompts = new PromptQueue();
  private query?: Query;
  private abortCtl = new AbortController();
  private nextEventId = 1;
  private ring: SessionEvent[] = [];
  private listeners = new Set<EventListener>();
  private closed = false;
  readonly broker: PermissionBroker;

  constructor(opts: {
    id: string;
    cwd: string;
    resume?: string;
    onPermission: PermissionListener;
  }) {
    this.id = opts.id;
    this.broker = new PermissionBroker(opts.onPermission);

    const options: Options = {
      cwd: opts.cwd,
      abortController: this.abortCtl,
      resume: opts.resume,
      includePartialMessages: false,
      canUseTool: async (toolName, input, ctx) => {
        return this.broker.request(toolName, input, {
          title: ctx.title,
          displayName: ctx.displayName,
          description: ctx.description,
          signal: ctx.signal,
        });
      },
    };

    this.query = query({ prompt: this.prompts, options });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (!this.query) return;
    try {
      for await (const event of this.query) {
        if (!this.claudeSessionId && (event as any).session_id) {
          this.claudeSessionId = (event as any).session_id;
        }
        const id = this.nextEventId++;
        const se: SessionEvent = { id, event };
        this.ring.push(se);
        if (this.ring.length > RING_CAPACITY) this.ring.shift();
        for (const l of this.listeners) {
          try { l(se); } catch { /* ignore listener errors */ }
        }
      }
    } catch (err) {
      // Surface as a synthetic error event for the UI.
      const id = this.nextEventId++;
      const se: SessionEvent = {
        id,
        event: {
          type: 'system',
          subtype: 'error' as any,
          message: (err as Error).message,
        } as unknown as SDKMessage,
      };
      this.ring.push(se);
      for (const l of this.listeners) { try { l(se); } catch { /* */ } }
    } finally {
      this.closed = true;
    }
  }

  getClaudeSessionId(): string | undefined {
    return this.claudeSessionId;
  }

  sendUser(text: string): void {
    if (this.closed) return;
    this.prompts.push(text);
  }

  async interrupt(): Promise<void> {
    try { await this.query?.interrupt(); } catch { /* best effort */ }
  }

  replay(afterId = 0): SessionEvent[] {
    return this.ring.filter((e) => e.id > afterId);
  }

  subscribe(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.prompts.close();
    try { this.abortCtl.abort(); } catch { /* */ }
    this.broker.drainDeny('Session closing');
  }
}
