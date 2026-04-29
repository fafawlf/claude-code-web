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
// Ring is the replay buffer. It must be bounded by BYTES not by count —
// `includePartialMessages: true` can produce thousands of partial events and a
// single tool_result can embed a whole file; 5000 "events" was easily > 4 GB.
const RING_MAX_BYTES = 32 * 1024 * 1024;
// Per-string cap applied BEFORE the event is stored. Downstream (ws.ts) also
// applies its own cap, but that one runs only on the egress path; this is the
// storage-side cap so the process itself doesn't hold the bytes.
const MAX_STORED_STRING = 32 * 1024;
const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export class ClaudeSession {
  readonly id: string;
  private state: SessionStateSnapshot;
  private prompts = new PromptQueue();
  private query?: Query;
  private abortCtl = new AbortController();
  private nextEventId = 1;
  private ring: SessionEvent[] = [];
  private ringSizes: number[] = [];
  private ringBytes = 0;
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

    // Diagnostic: flag any incoming raw event whose content sums past 4 MB.
    // `estimateEventBytes` walks primitives only (no stringify, no giant
    // string allocation), so it's safe even if the tree is huge.
    const rawBytes = estimateEventBytes(event);
    if (rawBytes > 4 * 1024 * 1024) {
      console.warn('[session] huge SDK event received', {
        type: (event as { type?: string })?.type,
        rawBytes,
      });
    }
    // 1. Storage-side shrink: bound every string node, drop image base64.
    //    Applied BEFORE the event enters the ring so the process memory is
    //    bounded even if replay is never read.
    const slim = shrinkEventForStorage(event);
    const se: SessionEvent = { id, event: slim };

    // 2. Partial stream events are ephemeral: they drive the live streaming
    //    UI, but replaying 1000+ deltas on reconnect blows memory and adds
    //    no value (the final `assistant` event carries the full message).
    //    Forward to listeners, but do NOT persist in the ring.
    const isPartial = (event.type as string) === 'stream_event';

    if (!isPartial) {
      const bytes = estimateEventBytes(slim);
      this.ring.push(se);
      this.ringSizes.push(bytes);
      this.ringBytes += bytes;
      // 3. Double-bounded ring: by count AND by estimated bytes.
      while (
        this.ring.length > 0 &&
        (this.ring.length > RING_CAPACITY || this.ringBytes > RING_MAX_BYTES)
      ) {
        this.ring.shift();
        const evicted = this.ringSizes.shift() ?? 0;
        this.ringBytes -= evicted;
      }
    }

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
          // Skip usage from partial stream_event deltas. With
          // `includePartialMessages: true` the SDK emits many partials per
          // turn, each carrying the *cumulative* usage to that point — if
          // we accept them we (a) re-accumulate and double-count, and
          // (b) fire updateState → state_update + sessions_update
          // broadcast per token. That's what buried the WS send buffer.
          // The final `assistant` / `result` event carries the turn's
          // authoritative usage; one update per turn is enough.
          const isPartial = (event.type as string) === 'stream_event';
          if (!isPartial) {
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

// Cap every string on an SDK event so one rogue tool_result (big file read,
// giant Bash output, base64 image) can never occupy the whole heap. Works on a
// shallow clone of the event — the original SDK object stays untouched and is
// still GC'd once the ingest callback returns.
function shrinkEventForStorage(event: SDKMessage): SDKMessage {
  if (!event || typeof event !== 'object') return event;
  const anyEv = event as any;
  const message = anyEv.message;
  if (!message || typeof message !== 'object') return event;
  const content = message.content;
  if (typeof content === 'string') {
    return { ...anyEv, message: { ...message, content: capStoredString(content) } };
  }
  if (!Array.isArray(content)) return event;
  const slimmed = content.map((part: unknown) => trimStoredContentPart(part));
  return { ...anyEv, message: { ...message, content: slimmed } };
}

function trimStoredContentPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part;
  const p = part as { type?: string; text?: unknown; content?: unknown; input?: unknown };
  switch (p.type) {
    case 'text':
      return typeof p.text === 'string' ? { ...p, text: capStoredString(p.text) } : p;
    case 'tool_use':
      if (p.input && typeof p.input === 'object') {
        return { ...p, input: trimStoredRecord(p.input as Record<string, unknown>) };
      }
      return p;
    case 'tool_result':
      return { ...p, content: trimStoredToolResult(p.content) };
    case 'image':
      return { ...p, source: { type: 'base64', media_type: 'image/png', data: '[image omitted]' } };
    default:
      return p;
  }
}

function trimStoredToolResult(content: unknown): unknown {
  if (typeof content === 'string') return capStoredString(content);
  if (Array.isArray(content)) return content.map((b) => trimStoredToolResultBlock(b));
  if (content && typeof content === 'object') return trimStoredToolResultBlock(content);
  return content;
}

function trimStoredToolResultBlock(block: unknown): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as { type?: string; text?: unknown };
  if (b.type === 'text' && typeof b.text === 'string') return { ...b, text: capStoredString(b.text) };
  if (b.type === 'image') return { ...b, source: { type: 'base64', media_type: 'image/png', data: '[image omitted]' } };
  return b;
}

function trimStoredRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = typeof v === 'string' ? capStoredString(v) : v;
  }
  return out;
}

function capStoredString(s: string): string {
  if (s.length <= MAX_STORED_STRING) return s;
  return s.slice(0, MAX_STORED_STRING) + `\n… [trimmed ${s.length - MAX_STORED_STRING} chars]`;
}

// Approximate JSON byte size of an already-shrunk event. Counts string
// character length — a JSON.stringify(event).length would give a tighter
// number, but that's exactly the allocation we can't afford to pay at
// ingestion time. Walking primitives is allocation-free.
function estimateEventBytes(event: unknown): number {
  let bytes = 0;
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    const t = typeof v;
    if (t === 'string') { bytes += (v as string).length; return; }
    if (t === 'number' || t === 'boolean') { bytes += 8; return; }
    if (Array.isArray(v)) { for (const item of v) walk(item); return; }
    if (t === 'object') {
      for (const k of Object.keys(v as object)) {
        bytes += k.length;
        walk((v as Record<string, unknown>)[k]);
      }
    }
  };
  walk(event);
  return bytes;
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
