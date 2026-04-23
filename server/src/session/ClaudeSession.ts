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
  readonly historyReady: Promise<void>;
  private historyReadyResolve!: () => void;

  private readonly viewerMode: boolean;
  private readonly cwd: string;
  private seenUuids = new Set<string>();

  constructor(opts: {
    id: string;
    cwd: string;
    resume?: string;
    model?: string;
    permissionMode?: PermissionMode;
    viewerMode?: boolean;
    onPermission: PermissionListener;
    onPlan: PlanListener;
  }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.viewerMode = !!opts.viewerMode;
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
      viewerMode: this.viewerMode,
    };
    this.permissionBroker = new PermissionBroker(opts.onPermission);
    this.planBroker = new PlanBroker(opts.onPlan);
    this.historyReady = new Promise<void>((resolve) => { this.historyReadyResolve = resolve; });

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

    if (this.viewerMode && opts.resume) {
      // Read-only: just load history. Do NOT spawn a Claude Code process.
      // Safe when the session may be actively written to by another process.
      void this.loadHistoryViewer(opts.resume, opts.cwd);
    } else if (opts.resume) {
      // Replay prior transcript from disk into the ring, then start live pump.
      void this.loadHistoryThenStart(opts.resume, opts.cwd, options);
    } else {
      this.query = query({ prompt: this.prompts, options });
      void this.pump();
      this.historyReadyResolve();
    }
  }

  private async loadHistoryViewer(resumeId: string, cwd: string): Promise<void> {
    try {
      const prior = await getSessionMessages(resumeId, { dir: cwd });
      for (const m of prior) {
        if (this.closed) return;
        const ev = { ...m, parent_tool_use_id: m.parent_tool_use_id ?? null } as unknown as SDKMessage;
        if ((m as any).uuid) this.seenUuids.add((m as any).uuid);
        this.pushEvent(ev);
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'failed to load history';
      this.pushEvent({
        type: 'system',
        subtype: 'error' as unknown as 'status',
        message: `Could not load transcript: ${msg}`,
      } as unknown as SDKMessage);
    }
    this.historyReadyResolve();
    // Viewer mode never starts a live SDK query. Calls to setUser are silently
    // ignored; refreshHistory() can be used to pull new messages appended by
    // whoever owns the session.
  }

  /** Re-read the session's transcript from disk and push any messages we
   *  haven't seen yet. Only makes sense in viewer mode, but is safe to call
   *  from anywhere (a no-op if no new messages found). */
  async refreshHistory(): Promise<number> {
    const claudeId = this.state.claudeSessionId;
    if (!claudeId) return 0;
    let added = 0;
    try {
      const prior = await getSessionMessages(claudeId, { dir: this.cwd });
      for (const m of prior) {
        const uuid = (m as any).uuid;
        if (uuid && this.seenUuids.has(uuid)) continue;
        if (uuid) this.seenUuids.add(uuid);
        const ev = { ...m, parent_tool_use_id: m.parent_tool_use_id ?? null } as unknown as SDKMessage;
        this.pushEvent(ev);
        added++;
      }
    } catch {
      // Best effort — errors surface as they do on initial load only if fatal.
    }
    return added;
  }

  private async loadHistoryThenStart(resumeId: string, cwd: string, baseOptions: Options): Promise<void> {
    try {
      const prior = await getSessionMessages(resumeId, { dir: cwd });
      for (const m of prior) {
        const ev = { ...m, parent_tool_use_id: m.parent_tool_use_id ?? null } as unknown as SDKMessage;
        if ((m as any).uuid) this.seenUuids.add((m as any).uuid);
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
    // Signal history ready BEFORE starting pump so WS can flush the batch
    // before any live event races in.
    this.historyReadyResolve();
    if (this.closed) return;
    // Rebuild options from current state — any setModel/setPermissionMode the
    // user performed while history was loading will have updated this.state,
    // and we want those reflected in the very first query() invocation.
    const finalOptions: Options = {
      ...baseOptions,
      ...(this.state.model ? { model: this.state.model } : {}),
      permissionMode: this.state.permissionMode,
    };
    this.query = query({ prompt: this.prompts, options: finalOptions });
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
    if (this.closed || this.viewerMode) return;
    this.prompts.push(text);
  }

  isViewer(): boolean { return this.viewerMode; }

  async setModel(model: string): Promise<void> {
    // Always reflect the user's intent in session state — it'll be honored as
    // the initial options when the query is finally constructed (resume path),
    // or forwarded to the live Query now (steady state).
    this.updateState({ model });
    if (!this.query) return; // history still loading; options will pick this up
    await this.query.setModel(model);
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.updateState({ permissionMode: mode });
    if (!this.query) return;
    await this.query.setPermissionMode(mode);
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
