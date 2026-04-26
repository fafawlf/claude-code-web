import { query, getSessionMessages, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import { resolveClaudePath } from './resolveClaudePath.js';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type AgentProviderId, type PendingControl, type PermissionMode, type SessionRuntimeStatus, type SessionStateSnapshot } from '../protocol.js';

export type SessionEvent = { id: number; event: SDKMessage };
export type EventListener = (ev: SessionEvent) => void;
export type StateListener = (state: Partial<SessionStateSnapshot>) => void;
export type ControlListener = (control: PendingControl) => void;
export type PermissionListener = (req: {
  reqId: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}) => void;
export type PlanListener = (req: { reqId: string; plan: string }) => void;

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
  private controlListeners = new Set<ControlListener>();
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
    nodeId?: string;
    nodeLabel?: string;
    provider?: AgentProviderId;
    cwd: string;
    resume?: string;
    model?: string;
    permissionMode?: PermissionMode;
    viewerMode?: boolean;
    onPermission?: PermissionListener;
    onPlan?: PlanListener;
  }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.viewerMode = !!opts.viewerMode;
    this.state = {
      sessionId: opts.id,
      nodeId: opts.nodeId ?? DEFAULT_NODE_ID,
      nodeLabel: opts.nodeLabel,
      provider: opts.provider ?? DEFAULT_AGENT_PROVIDER,
      providerSessionId: opts.resume,
      cwd: opts.cwd,
      // When resuming, the Claude session id is known up-front; helps the UI
      // show the right title / rename target without waiting for the first
      // live event.
      claudeSessionId: opts.resume,
      model: opts.model,
      permissionMode: opts.permissionMode ?? 'default',
      runtimeStatus: 'idle',
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: Date.now(),
      tokensIn: 0,
      tokensOut: 0,
      viewerMode: this.viewerMode,
    };
    this.permissionBroker = new PermissionBroker((req) => {
      opts.onPermission?.(req);
      this.setRuntimeStatus('waiting_permission');
      this.emitControl({ kind: 'permission', ...req });
    });
    this.planBroker = new PlanBroker((req) => {
      opts.onPlan?.(req);
      this.setRuntimeStatus('waiting_plan');
      this.emitControl({ kind: 'plan', ...req });
    });
    this.historyReady = new Promise<void>((resolve) => { this.historyReadyResolve = resolve; });

    if (this.viewerMode && opts.resume) {
      // Read-only: just load history. Do NOT spawn a Claude Code process.
      // Safe when the session may be actively written to by another process.
      void this.loadHistoryViewer(opts.resume, opts.cwd);
    } else if (opts.resume) {
      // Replay prior transcript from disk into the ring, then start live pump.
      void this.loadHistoryThenStart(opts.resume, opts.cwd);
    } else {
      // Fresh chats are lazy: do not spawn a Claude Code subprocess until the
      // first user prompt. This keeps empty project clicks out of Claude's
      // session store and avoids "lost empty chat" noise in the UI.
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

  private async loadHistoryThenStart(resumeId: string, cwd: string): Promise<void> {
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
    this.startQuery(resumeId);
  }

  private pushEvent(event: SDKMessage): void {
    const anyEv = event as any;
    if (!this.state.claudeSessionId && anyEv.session_id) {
      this.updateState({ claudeSessionId: anyEv.session_id, providerSessionId: anyEv.session_id });
    }
    const activeToolDelta = this.activeToolDelta(event);
    const id = this.nextEventId++;
    this.state = { ...this.state, lastEventId: id, lastEventAt: Date.now(), ...activeToolDelta };
    const se: SessionEvent = { id, event };
    this.ring.push(se);
    if (this.ring.length > RING_CAPACITY) this.ring.shift();
    for (const l of this.listeners) { try { l(se); } catch { /* */ } }
    if (event.type === 'result') this.setRuntimeStatus('idle');
    if (event.type === 'system' && (event as any).subtype === 'error') this.setRuntimeStatus('error');
  }

  private activeToolDelta(event: SDKMessage): Partial<SessionStateSnapshot> {
    const content = (event as any)?.message?.content;
    if (event.type === 'assistant' && Array.isArray(content)) {
      const tool = [...content].reverse().find((p) => p?.type === 'tool_use' && typeof p.id === 'string');
      if (tool) {
        return {
          activeTool: {
            toolUseId: tool.id,
            name: String(tool.name ?? 'Tool'),
            startedAt: Date.now(),
            inputSummary: summarizeToolInput(String(tool.name ?? 'Tool'), tool.input),
          },
        };
      }
    }
    if (event.type === 'user' && Array.isArray(content) && this.state.activeTool) {
      const matched = content.some((p) => p?.type === 'tool_result' && p.tool_use_id === this.state.activeTool?.toolUseId);
      if (matched) return { activeTool: undefined };
    }
    if (event.type === 'result' || (event.type === 'system' && (event as any).subtype === 'error')) return { activeTool: undefined };
    return {};
  }

  // Supervisor-style pump: runs the SDK query to completion, and when it exits
  // unexpectedly (not from user close/interrupt) respawns with current state.
  // This prevents "session death" after control-request failures (e.g. the CLI
  // subprocess exits when toggling certain permission modes).
  private relaunchCount = 0;
  private lastRelaunchAt = 0;

  private async pump(): Promise<void> {
    while (!this.closed) {
      if (!this.query) return;
      try {
        for await (const event of this.query) {
          const anyEv = event as any;
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
      }

      // Query ended. If explicit close, stop.
      if (this.closed) break;

      // Never relaunch without a known claudeSessionId — a fresh query would
      // silently start a brand-new Claude session with a new id, which is
      // worse than surfacing the failure. The UI can offer "new chat".
      if (!this.state.claudeSessionId) {
        this.pushEvent({
          type: 'system',
          subtype: 'error' as unknown as 'status',
          message: 'SDK exited before any event — giving up. Start a new chat.',
        } as unknown as SDKMessage);
        this.closed = true;
        this.updateState({ runtimeStatus: 'closed' });
        break;
      }

      // Otherwise, the SDK subprocess exited on its own. Rebuild options from
      // current state (preserves user's mode/model) and respawn. Rate-limit to
      // avoid tight loops: at most 5 relaunches per 30s.
      const now = Date.now();
      if (now - this.lastRelaunchAt < 30_000) {
        this.relaunchCount += 1;
      } else {
        this.relaunchCount = 1;
      }
      this.lastRelaunchAt = now;
      if (this.relaunchCount > 5) {
        this.pushEvent({
          type: 'system',
          subtype: 'error' as unknown as 'status',
          message: 'Session relaunched too many times — stopping. Click "New chat" or reload.',
        } as unknown as SDKMessage);
        this.closed = true;
        this.updateState({ runtimeStatus: 'closed' });
        break;
      }

      this.pushEvent({
        type: 'system',
        subtype: 'info' as unknown as 'status',
        message: 'Session re-initialized with current settings.',
      } as unknown as SDKMessage);

      this.abortCtl = new AbortController();
      this.query = query({ prompt: this.prompts, options: this.buildOptions(this.state.claudeSessionId) });
      // loop continues, awaits the new query
    }
  }

  private buildOptions(resume?: string): Options {
    const claudePath = resolveClaudePath();
    return {
      cwd: this.cwd,
      abortController: this.abortCtl,
      ...(resume ? { resume } : {}),
      includePartialMessages: true,
      ...(this.state.model ? { model: this.state.model } : {}),
      // Only forward 'plan' to the SDK (it actually changes the model's system
      // reminder). 'acceptEdits' and 'bypassPermissions' are implemented
      // entirely in our canUseTool below, so the SDK stays in 'default' and
      // the CLI subprocess never has to re-initialize when the user toggles
      // between those modes.
      permissionMode: this.state.permissionMode === 'plan' ? 'plan' : 'default',
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      canUseTool: this.canUseToolImpl,
    };
  }

  private startQuery(resume?: string): void {
    if (this.query || this.closed || this.viewerMode) return;
    this.abortCtl = new AbortController();
    this.query = query({ prompt: this.prompts, options: this.buildOptions(resume) });
    void this.pump();
  }

  private updateState(delta: Partial<SessionStateSnapshot>): void {
    this.state = { ...this.state, ...delta };
    for (const l of this.stateListeners) { try { l(delta); } catch { /* */ } }
  }

  private setRuntimeStatus(runtimeStatus: SessionRuntimeStatus): void {
    if (this.state.runtimeStatus === runtimeStatus) return;
    this.updateState({ runtimeStatus });
  }

  private refreshRuntimeStatus(fallback: SessionRuntimeStatus): void {
    const pending = this.getPendingControls();
    if (pending.some((c) => c.kind === 'permission')) this.setRuntimeStatus('waiting_permission');
    else if (pending.some((c) => c.kind === 'plan')) this.setRuntimeStatus('waiting_plan');
    else if (!this.closed) this.setRuntimeStatus(fallback);
  }

  private emitControl(control: PendingControl): void {
    for (const l of this.controlListeners) { try { l(control); } catch { /* */ } }
  }

  getState(): SessionStateSnapshot {
    return { ...this.state };
  }

  private canUseToolImpl = async (toolName: string, input: Record<string, unknown>, ctx: {
    signal: AbortSignal;
    title?: string;
    displayName?: string;
    description?: string;
    toolUseID: string;
  }): Promise<any> => {
    if (toolName === 'ExitPlanMode') {
      const plan = typeof input.plan === 'string' ? input.plan : JSON.stringify(input, null, 2);
      try {
        const result = await this.planBroker.awaitApproval(plan, ctx.signal);
        if (result.behavior === 'allow') {
          try {
            await this.query?.setPermissionMode('default');
            this.updateState({ permissionMode: 'default' });
          } catch { /* best effort */ }
        }
        return result;
      } finally {
        this.refreshRuntimeStatus('running');
      }
    }
    // "bypass" is implemented here, not at the SDK level — avoids the CLI
    // subprocess exiting with "bypass_permissions_disabled" on toggle.
    if (this.state.permissionMode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input };
    }
    if (this.state.permissionMode === 'acceptEdits' && EDIT_LIKE.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    try {
      return await this.permissionBroker.request(toolName, input, {
        toolUseId: ctx.toolUseID,
        title: ctx.title,
        displayName: ctx.displayName,
        description: ctx.description,
        signal: ctx.signal,
      });
    } finally {
      this.refreshRuntimeStatus('running');
    }
  };

  sendUser(text: string): void {
    if (this.closed || this.viewerMode) return;
    this.setRuntimeStatus('running');
    this.prompts.push(text);
    this.startQuery(this.state.claudeSessionId);
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
    const previousSdkMode: PermissionMode = this.state.permissionMode === 'plan' ? 'plan' : 'default';
    const nextSdkMode: PermissionMode = mode === 'plan' ? 'plan' : 'default';
    this.updateState({ permissionMode: mode });
    // IMPORTANT: only forward to the SDK when the SDK-level mode actually
    // changes. default/acceptEdits/bypass all map to 'default' at the SDK
    // level (we enforce accept/bypass in canUseToolImpl), so switching
    // between them does not need an SDK control request. Calling
    // query.setPermissionMode needlessly was what triggered the CLI
    // subprocess to exit and made the session appear to "reset" on bypass.
    if (!this.query || nextSdkMode === previousSdkMode) return;
    await this.query.setPermissionMode(nextSdkMode);
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

  subscribeControls(l: ControlListener): () => void {
    this.controlListeners.add(l);
    return () => this.controlListeners.delete(l);
  }

  getPendingControls(): PendingControl[] {
    return [
      ...this.permissionBroker.getPending().map((p) => ({ kind: 'permission' as const, ...p })),
      ...this.planBroker.getPending().map((p) => ({ kind: 'plan' as const, ...p })),
    ];
  }

  isClosed(): boolean { return this.closed; }

  async close(): Promise<void> {
    this.closed = true;
    this.updateState({ runtimeStatus: 'closed', activeTool: undefined });
    this.prompts.close();
    try { this.abortCtl.abort(); } catch { /* */ }
    this.permissionBroker.drainDeny();
    this.planBroker.drainReject();
  }
}

function summarizeToolInput(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const value =
    name === 'Bash' ? obj.command :
    (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'MultiEdit') ? obj.file_path :
    name === 'Grep' ? obj.pattern :
    name === 'Glob' ? obj.pattern :
    Object.values(obj)[0];
  if (typeof value !== 'string') return undefined;
  return value.length > 120 ? value.slice(0, 117) + '...' : value;
}
