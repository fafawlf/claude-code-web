import { query, getSessionMessages, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import { resolveClaudePath } from './resolveClaudePath.js';
import type { PermissionMode, SessionStateSnapshot } from '../protocol.js';

export type SessionEvent = { id: number; event: SDKMessage };
export type EventListener = (ev: SessionEvent) => void;
export type StateListener = (state: Partial<SessionStateSnapshot>) => void;
export type PermissionListener = (req: {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}) => boolean;
export type PlanListener = (req: { reqId: string; plan: string }) => boolean;

type Pending = { resolve: (v: IteratorResult<SDKUserMessage>) => void };

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

const RING_CAPACITY = 5000;
const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export class ClaudeSession {
  readonly id: string;
  private state: SessionStateSnapshot;
  private prompts = new PromptQueue();
  private query?: Query;
  private abortCtl = new AbortController();
  private nextEventId = 1;
  private ring: SessionEvent[] = [];
  private listeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private closed = false;
  readonly permissionBroker: PermissionBroker;
  readonly planBroker: PlanBroker;

  constructor(opts: {
    id: string;
    cwd: string;
    resume?: string;
    model?: string;
    permissionMode?: PermissionMode;
    onPermission: PermissionListener;
    onPlan: PlanListener;
  }) {
    this.id = opts.id;
    this.state = {
      sessionId: opts.id,
      cwd: opts.cwd,
      // When resuming, the Claude session id is known up-front; helps the UI
      // show the right title / rename target without waiting for the first
      // live event.
      claudeSessionId: opts.resume,
      model: opts.model,
      permissionMode: opts.permissionMode ?? 'default',
      tokensIn: 0,
      tokensOut: 0,
    };
    this.permissionBroker = new PermissionBroker(opts.onPermission);
    this.planBroker = new PlanBroker(opts.onPlan);

    const claudePath = resolveClaudePath();
    const options: Options = {
      cwd: opts.cwd,
      abortController: this.abortCtl,
      resume: opts.resume,
      includePartialMessages: true,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      canUseTool: async (toolName, input, ctx) => {
        // ExitPlanMode: custom flow — show plan to user, auto-flip mode on approve.
        if (toolName === 'ExitPlanMode') {
          const plan = typeof input.plan === 'string' ? input.plan : JSON.stringify(input, null, 2);
          const result = await this.planBroker.awaitApproval(plan, ctx.signal);
          if (result.behavior === 'allow') {
            try {
              await this.query?.setPermissionMode('default');
              this.updateState({ permissionMode: 'default' });
            } catch { /* best effort */ }
          }
          return result;
        }

        // acceptEdits mode: auto-allow edit tools without prompting.
        if (this.state.permissionMode === 'acceptEdits' && EDIT_LIKE.has(toolName)) {
          return { behavior: 'allow', updatedInput: input };
        }

        return this.permissionBroker.request(toolName, input, {
          toolUseId: ctx.toolUseID,
          title: ctx.title,
          displayName: ctx.displayName,
          description: ctx.description,
          signal: ctx.signal,
        });
      },
    };

    if (opts.resume) {
      // Replay prior transcript from disk into the ring, then start live pump.
      // History streaming runs before the SDK query spins up so the UI renders
      // history first, then live events continue from where Claude left off.
      void this.loadHistoryThenStart(opts.resume, opts.cwd, options);
    } else {
      this.query = query({ prompt: this.prompts, options });
      void this.pump();
    }
  }

  private async loadHistoryThenStart(resumeId: string, cwd: string, options: Options): Promise<void> {
    try {
      const prior = await getSessionMessages(resumeId, { dir: cwd });
      for (const m of prior) {
        // Shape is close enough to SDKMessage that the reducer's user/assistant
        // handling treats it identically. Tool results embedded in user messages
        // get matched back to their tool_use by tool_use_id as normal.
        const ev = { ...m, parent_tool_use_id: m.parent_tool_use_id ?? null } as unknown as SDKMessage;
        this.pushEvent(ev);
        if (this.closed) return;
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'failed to load history';
      this.pushEvent({
        type: 'system',
        subtype: 'error' as unknown as 'status',
        message: `Could not load prior transcript: ${msg}`,
      } as unknown as SDKMessage);
    }
    if (this.closed) return;
    this.query = query({ prompt: this.prompts, options });
    void this.pump();
  }

  private pushEvent(event: SDKMessage): void {
    const anyEv = event as any;
    if (!this.state.claudeSessionId && anyEv.session_id) {
      this.updateState({ claudeSessionId: anyEv.session_id });
    }
    const id = this.nextEventId++;
    const se: SessionEvent = { id, event };
    this.ring.push(se);
    if (this.ring.length > RING_CAPACITY) this.ring.shift();
    for (const l of this.listeners) { try { l(se); } catch { /* */ } }
  }

  private async pump(): Promise<void> {
    if (!this.query) return;
    try {
      for await (const event of this.query) {
        const anyEv = event as any;
        // Token bookkeeping — best-effort.
        const usage = anyEv?.message?.usage ?? anyEv?.usage;
        if (usage && typeof usage === 'object') {
          const delta: Partial<SessionStateSnapshot> = {};
          if (typeof usage.input_tokens === 'number') delta.tokensIn = this.state.tokensIn + usage.input_tokens;
          if (typeof usage.output_tokens === 'number') delta.tokensOut = this.state.tokensOut + usage.output_tokens;
          if (Object.keys(delta).length) this.updateState(delta);
        }
        if (event.type === 'result' && typeof (event as any).total_cost_usd === 'number') {
          this.updateState({ cost: (event as any).total_cost_usd });
        }
        this.pushEvent(event);
      }
    } catch (err) {
      this.pushEvent({
        type: 'system',
        subtype: 'error' as unknown as 'status',
        message: (err as Error).message,
      } as unknown as SDKMessage);
    } finally {
      this.closed = true;
    }
  }

  private updateState(delta: Partial<SessionStateSnapshot>): void {
    this.state = { ...this.state, ...delta };
    for (const l of this.stateListeners) { try { l(delta); } catch { /* */ } }
  }

  getState(): SessionStateSnapshot {
    return { ...this.state };
  }

  sendUser(text: string): void {
    if (this.closed) return;
    this.prompts.push(text);
  }

  async setModel(model: string): Promise<void> {
    try { await this.query?.setModel(model); this.updateState({ model }); }
    catch (e) { throw e; }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    try {
      await this.query?.setPermissionMode(mode);
      this.updateState({ permissionMode: mode });
    } catch (e) { throw e; }
  }

  async interrupt(): Promise<void> {
    try { await this.query?.interrupt(); } catch { /* */ }
  }

  replay(afterId = 0): SessionEvent[] {
    return this.ring.filter((e) => e.id > afterId);
  }

  subscribe(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  subscribeState(l: StateListener): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  isClosed(): boolean { return this.closed; }

  async close(): Promise<void> {
    this.closed = true;
    this.prompts.close();
    try { this.abortCtl.abort(); } catch { /* */ }
    this.permissionBroker.drainDeny();
    this.planBroker.drainReject();
  }
}
