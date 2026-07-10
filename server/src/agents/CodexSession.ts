import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import { resolveCodexPath } from './resolveCodexPath.js';
import { DEFAULT_NODE_ID, type ActiveToolInfo, type PendingControl, type PermissionMode, type SessionRuntimeStatus, type SessionStateSnapshot } from '../protocol.js';
import type { AgentSessionOptions } from './types.js';
import { envWithGitIdentity, type GitIdentity } from '../git/identity.js';
import type { ControlListener, EventListener, SessionEvent, StateListener } from '../session/ClaudeSession.js';
import { ReplayBuffer, boundReplayValue, type HistoryLoadMetadata } from '../session/ReplayBuffer.js';
import { streamCodexTranscriptEvents } from './codexTranscript.js';

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  timestamp?: string;
  payload?: {
    id?: string;
    type?: string;
    role?: string;
    message?: string;
    content?: Array<{ type?: string; text?: string }>;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    command?: string[];
    aggregated_output?: string;
    exit_code?: number;
    last_agent_message?: string;
    model?: string;
    [key: string]: unknown;
  };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export class CodexSession {
  readonly id: string;
  readonly permissionBroker: PermissionBroker;
  readonly planBroker: PlanBroker;
  readonly historyReady: Promise<void>;

  private state: SessionStateSnapshot;
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private closed = false;
  private running = false;
  private pendingPrompts: string[] = [];
  private nextEventId = 1;
  private ring = new ReplayBuffer<SessionEvent>();
  private listeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private controlListeners = new Set<ControlListener>();
  private stderrTail = '';
  private activeTurn?: ActiveToolInfo;
  private historyReadyResolve!: () => void;
  private historySettled = false;
  private historyMetadata: HistoryLoadMetadata = { status: 'ready', truncated: false };
  private historySourceTruncated = false;
  private historyAbortCtl = new AbortController();
  private deferredHistoryPrompts: string[] = [];
  private seenAssistantTexts = new BoundedKeySet();
  private seenUserTexts = new BoundedKeySet();
  private seenToolCalls = new BoundedKeySet();
  private seenToolResults = new BoundedKeySet();
  private resultPushedForTurn = false;
  private readonly gitIdentity?: GitIdentity;

  constructor(opts: AgentSessionOptions) {
    this.id = opts.id;
    this.gitIdentity = opts.gitIdentity;
    this.state = {
      sessionId: opts.id,
      nodeId: opts.nodeId ?? DEFAULT_NODE_ID,
      nodeLabel: opts.nodeLabel,
      provider: 'codex',
      providerSessionId: opts.resume,
      claudeSessionId: opts.resume,
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode ?? 'default',
      runtimeStatus: 'idle',
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: Date.now(),
      tokensIn: 0,
      tokensOut: 0,
      viewerMode: !!opts.viewerMode,
    };
    this.permissionBroker = new PermissionBroker(() => {
      throw new Error('Codex provider does not expose web permission prompts yet');
    });
    this.planBroker = new PlanBroker(() => {
      throw new Error('Codex provider does not expose plan approval yet');
    });
    this.historyMetadata = {
      status: opts.resume ? 'loading' : 'ready',
      truncated: false,
    };
    this.historyReady = new Promise<void>((resolve) => { this.historyReadyResolve = resolve; });
    if (opts.resume) void this.loadHistory(opts.resume);
    else this.settleHistory('ready');
  }

  sendUser(text: string): void {
    if (this.closed || this.state.viewerMode) return;
    if (this.historyMetadata.status === 'loading') {
      this.deferredHistoryPrompts.push(text);
      return;
    }
    this.sendUserAfterHistory(text);
  }

  private sendUserAfterHistory(text: string): void {
    if (this.closed || this.state.viewerMode) return;
    this.seenUserTexts.add(dedupeTextKey(text));
    this.pushEvent({ type: 'user', message: { role: 'user', content: text } });
    if (this.running) {
      this.pendingPrompts.push(text);
      return;
    }
    this.startTurn(text);
  }

  async setModel(model: string): Promise<void> {
    this.updateState({ model });
  }

  async setClaudeAuthMode(): Promise<void> {
    // Codex auth is managed separately; this wire command is Claude-only.
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.updateState({ permissionMode: mode });
  }

  async interrupt(): Promise<void> {
    if (!this.child) return;
    try { this.child.kill('SIGTERM'); } catch { /* best effort */ }
    this.pushEvent({ type: 'system', subtype: 'error', message: 'Codex turn interrupted.' });
    this.finishTurn('idle');
  }

  async refreshHistory(): Promise<number> {
    const resumeId = this.state.providerSessionId;
    if (!resumeId || this.closed) return 0;
    const before = this.state.lastEventId;
    try {
      await this.replayHistory(resumeId);
    } catch {
      // Best effort. Initial-load failures are surfaced through metadata.
    }
    return this.state.lastEventId - before;
  }

  isViewer(): boolean { return !!this.state.viewerMode; }
  isClosed(): boolean { return this.closed; }

  async close(): Promise<void> {
    this.closed = true;
    this.pendingPrompts = [];
    this.deferredHistoryPrompts = [];
    try { this.historyAbortCtl.abort(); } catch { /* best effort */ }
    try { this.child?.kill('SIGTERM'); } catch { /* best effort */ }
    this.permissionBroker.drainDeny();
    this.planBroker.drainReject();
    this.updateState({ runtimeStatus: 'closed', activeTool: undefined });
  }

  getState(): SessionStateSnapshot {
    return { ...this.state };
  }

  getHistoryMetadata(): HistoryLoadMetadata {
    return { ...this.historyMetadata, truncated: this.historySourceTruncated || this.ring.truncated };
  }

  replay(afterId = 0): SessionEvent[] {
    return this.ring.filter((e) => e.id > afterId);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeControls(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  getPendingControls(): PendingControl[] {
    return [
      ...this.permissionBroker.getPending().map((p) => ({ kind: 'permission' as const, ...p })),
      ...this.planBroker.getPending().map((p) => ({ kind: 'plan' as const, ...p })),
    ];
  }

  private startTurn(prompt: string): void {
    const codexPath = resolveCodexPath();
    if (!codexPath) {
      this.pushEvent({ type: 'system', subtype: 'error', message: 'Codex executable not found. Install codex or set CODEX_PATH.' });
      this.finishTurn('error');
      return;
    }

    this.running = true;
    this.stderrTail = '';
    this.resultPushedForTurn = false;
    this.activeTurn = {
      toolUseId: `codex_turn_${this.nextEventId}`,
      name: 'Codex',
      startedAt: Date.now(),
      inputSummary: summarizePrompt(prompt),
    };
    this.updateState({ runtimeStatus: 'running', activeTool: this.activeTurn });

    const args = this.buildArgs(prompt);
    const directNodeScript = /\.(?:cjs|mjs|js)$/.test(codexPath);
    const child = spawn(directNodeScript ? process.execPath : codexPath, directNodeScript ? [codexPath, ...args] : args, {
      cwd: this.state.cwd,
      env: envWithGitIdentity(process.env, this.gitIdentity),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.readJsonLines(child.stdout, (event) => this.handleCodexEvent(event));
    child.stderr.on('data', (chunk) => {
      this.stderrTail = tail(this.stderrTail + chunk.toString('utf8'), 4000);
    });
    child.on('error', (err) => {
      this.pushEvent({ type: 'system', subtype: 'error', message: err.message });
      this.finishTurn('error');
    });
    child.on('close', (code, signal) => {
      if (this.closed) return;
      if (code && code !== 0) {
        const detail = this.stderrTail.trim();
        this.pushEvent({
          type: 'system',
          subtype: 'error',
          message: `Codex exited with ${signal ?? `code ${code}`}${detail ? `\n\n${detail}` : ''}`,
        });
        this.finishTurn('error');
        return;
      }
      this.finishTurn('idle');
    });
  }

  private buildArgs(prompt: string): string[] {
    if (this.state.providerSessionId) {
      const args = ['exec', 'resume', '--json', '--skip-git-repo-check'];
      if (this.state.model) args.push('--model', this.state.model);
      if (this.state.permissionMode === 'bypassPermissions') {
        args.push('--dangerously-bypass-approvals-and-sandbox');
      } else if (this.state.permissionMode !== 'plan') {
        args.push('--full-auto');
      }
      args.push(this.state.providerSessionId, prompt);
      return args;
    }

    const args = ['exec', '--json', '--skip-git-repo-check', '--color', 'never'];
    if (this.state.model) args.push('--model', this.state.model);
    if (this.state.permissionMode === 'plan') {
      args.push('--sandbox', 'read-only');
    } else if (this.state.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--sandbox', 'workspace-write');
    }
    args.push(prompt);
    return args;
  }

  private readJsonLines(stream: NodeJS.ReadableStream, onJson: (event: CodexJsonEvent) => void): void {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) this.parseJsonLine(line, onJson);
        idx = buffer.indexOf('\n');
      }
    });
    stream.on('end', () => {
      const line = buffer.trim();
      if (line) this.parseJsonLine(line, onJson);
    });
  }

  private parseJsonLine(line: string, onJson: (event: CodexJsonEvent) => void): void {
    try {
      onJson(JSON.parse(line) as CodexJsonEvent);
    } catch {
      // Ignore non-JSON warnings; Codex occasionally logs diagnostics nearby.
    }
  }

  private handleCodexEvent(event: CodexJsonEvent): void {
    switch (event.type) {
      case 'session_meta':
        if (event.payload?.id) {
          this.updateState({
            providerSessionId: event.payload.id,
            claudeSessionId: event.payload.id,
            model: typeof event.payload.model === 'string' ? event.payload.model : this.state.model,
          });
        }
        break;
      case 'event_msg':
        this.handleCodexEventMessage(event.payload);
        break;
      case 'response_item':
        this.handleCodexResponseItem(event.payload);
        break;
      case 'thread.started':
        if (event.thread_id) {
          this.updateState({
            providerSessionId: event.thread_id,
            claudeSessionId: event.thread_id,
          });
        }
        break;
      case 'turn.started':
        this.updateState({ runtimeStatus: 'running', activeTool: this.activeTurn });
        break;
      case 'item.completed':
        this.handleCompletedItem(event.item);
        break;
      case 'turn.completed':
        this.updateUsage(event.usage);
        this.pushResult();
        break;
      case 'error':
        if (event.message && !event.message.startsWith('Reconnecting...')) {
          this.pushEvent({ type: 'system', subtype: 'error', message: event.message });
        } else if (event.message && this.activeTurn) {
          this.updateState({
            activeTool: { ...this.activeTurn, inputSummary: 'Reconnecting to Codex...' },
          });
        }
        break;
    }
  }

  private handleCodexEventMessage(payload: CodexJsonEvent['payload']): void {
    if (!payload) return;
    switch (payload.type) {
      case 'task_started':
        this.updateState({ runtimeStatus: 'running', activeTool: this.activeTurn });
        break;
      case 'user_message':
        if (typeof payload.message === 'string') this.pushUserText(payload.message);
        break;
      case 'agent_message':
        if (typeof payload.message === 'string') this.pushAssistantText(payload.message);
        break;
      case 'exec_command_end': {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
        if (callId) {
          this.pushToolResult(callId, payload.aggregated_output ?? '', (payload.exit_code ?? 0) !== 0);
        }
        break;
      }
      case 'task_complete':
        if (typeof payload.last_agent_message === 'string') this.pushAssistantText(payload.last_agent_message);
        this.pushResult();
        break;
    }
  }

  private handleCodexResponseItem(payload: CodexJsonEvent['payload']): void {
    if (!payload) return;
    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const text = payload.content
        .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
      this.pushAssistantText(text);
      return;
    }
    if (payload.type === 'function_call') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : `codex_tool_${this.nextEventId}`;
      if (this.seenToolCalls.has(callId)) return;
      this.seenToolCalls.add(callId);
      const name = codexToolName(typeof payload.name === 'string' ? payload.name : 'CodexTool');
      const input = parseCodexArguments(payload.arguments);
      this.pushEvent({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: callId, name, input }] },
      });
      this.updateState({
        runtimeStatus: 'running',
        activeTool: {
          toolUseId: callId,
          name,
          startedAt: Date.now(),
          inputSummary: summarizeCodexToolInput(name, input),
        },
      });
      return;
    }
    if (payload.type === 'function_call_output') {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      if (callId) this.pushToolResult(callId, payload.output ?? '', false);
      return;
    }
    if ((payload.type === 'reasoning' || payload.type === 'thinking') && typeof payload.text === 'string' && payload.text.trim()) {
      this.pushEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: payload.text }] } });
    }
  }

  private handleCompletedItem(item: CodexJsonEvent['item']): void {
    if (!item) return;
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      this.pushAssistantText(item.text);
      return;
    }
    if ((item.type === 'reasoning' || item.type === 'thinking') && typeof item.text === 'string' && item.text.trim()) {
      this.pushEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: item.text }] } });
      return;
    }
    if (item.type && /command|exec|tool/i.test(item.type)) {
      const id = item.id ?? `codex_tool_${this.nextEventId}`;
      this.pushEvent({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name: codexToolName(item.type), input: item }] },
      });
      this.pushEvent({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(item, null, 2), is_error: false }] },
      });
    }
  }

  private updateUsage(usage: CodexJsonEvent['usage']): void {
    if (!usage) return;
    const tokensIn = this.state.tokensIn + (usage.input_tokens ?? 0);
    const tokensOut = this.state.tokensOut + (usage.output_tokens ?? 0);
    this.updateState({ tokensIn, tokensOut });
  }

  private pushEvent(event: any): void {
    const id = this.nextEventId++;
    this.state = { ...this.state, lastEventId: id, lastEventAt: Date.now() };
    const se: SessionEvent = { id, event: boundReplayValue(event, undefined, true) };
    this.ring.push(se);
    for (const listener of this.listeners) { try { listener(se); } catch { /* noop */ } }
  }

  private pushUserText(text: string): void {
    const key = dedupeTextKey(text);
    if (!key || this.seenUserTexts.has(key)) return;
    this.seenUserTexts.add(key);
    this.pushEvent({ type: 'user', message: { role: 'user', content: text } });
  }

  private pushAssistantText(text: string): void {
    const key = dedupeTextKey(text);
    if (!key || this.seenAssistantTexts.has(key)) return;
    this.seenAssistantTexts.add(key);
    this.pushEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  }

  private pushToolResult(toolUseId: string, content: unknown, isError: boolean): void {
    if (this.seenToolResults.has(toolUseId)) return;
    this.seenToolResults.add(toolUseId);
    this.pushEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: String(content ?? ''), is_error: isError }],
      },
    });
    if (this.state.activeTool?.toolUseId === toolUseId) {
      this.updateState({ activeTool: this.activeTurn });
    }
  }

  private pushResult(): void {
    if (this.resultPushedForTurn) return;
    this.resultPushedForTurn = true;
    this.pushEvent({ type: 'result' });
    this.updateState({ runtimeStatus: 'idle', activeTool: undefined });
  }

  private async loadHistory(resumeId: string): Promise<void> {
    let failure: string | undefined;
    let cancelled = false;
    try {
      await this.replayHistory(resumeId);
    } catch (error) {
      cancelled = this.closed || isAbortError(error);
      if (!cancelled) {
        failure = (error as Error).message || 'failed to load Codex history';
        this.pushEvent({ type: 'system', subtype: 'error', message: `Could not load Codex transcript: ${failure}` });
      }
    } finally {
      if (!this.running && this.state.runtimeStatus === 'running') {
        this.updateState({ runtimeStatus: 'idle', activeTool: undefined });
      }
      this.settleHistory(failure ? 'error' : 'ready', failure, cancelled);
    }
  }

  private async replayHistory(resumeId: string): Promise<void> {
    for await (const event of streamCodexTranscriptEvents(resumeId, {
      signal: this.historyAbortCtl.signal,
      onTruncated: (truncated) => { this.historySourceTruncated ||= truncated; },
    })) {
      if (this.closed) break;
      this.handleCodexEvent(event as CodexJsonEvent);
    }
  }

  private settleHistory(status: 'ready' | 'error', error?: string, cancelled = false): void {
    if (this.historySettled) return;
    this.historySettled = true;
    this.historyMetadata = {
      status,
      truncated: this.historySourceTruncated || this.ring.truncated,
      ...(error ? { error } : {}),
      ...(cancelled ? { cancelled: true } : {}),
    };
    this.historyReadyResolve();
    if (this.closed || this.state.viewerMode || this.deferredHistoryPrompts.length === 0) return;
    const prompts = this.deferredHistoryPrompts.splice(0);
    for (const prompt of prompts) this.sendUserAfterHistory(prompt);
  }

  private updateState(delta: Partial<SessionStateSnapshot>): void {
    this.state = { ...this.state, ...delta };
    for (const listener of this.stateListeners) { try { listener(delta); } catch { /* noop */ } }
  }

  private finishTurn(status: SessionRuntimeStatus): void {
    this.running = false;
    this.child = undefined;
    this.activeTurn = undefined;
    if (status === 'idle') this.pushResult();
    else this.updateState({ runtimeStatus: status, activeTool: undefined });
    const next = this.pendingPrompts.shift();
    if (next && !this.closed) this.startTurn(next);
  }
}

function codexToolName(type: string): string {
  if (/command|exec/i.test(type)) return 'Bash';
  return 'CodexTool';
}

function tail(value: string, max: number): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

function parseCodexArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.cmd === 'string' && typeof obj.command !== 'string') obj.command = obj.cmd;
      return obj;
    }
  } catch {
    // Fall through to a raw value; older Codex builds may not JSON-encode args.
  }
  return { value };
}

function summarizeCodexToolInput(name: string, input: Record<string, unknown>): string | undefined {
  const value =
    name === 'Bash' ? input.cmd ?? input.command :
    input.file_path ?? input.path ?? Object.values(input)[0];
  if (Array.isArray(value)) return value.join(' ').slice(0, 120);
  if (typeof value !== 'string') return undefined;
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function dedupeTextKey(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  let normalizedLength = 0;
  let inWhitespace = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    const whitespace = code <= 32 || code === 160;
    if (whitespace) {
      if (inWhitespace) continue;
      inWhitespace = true;
      hashA = Math.imul(hashA ^ 32, 0x01000193);
      hashB = Math.imul(hashB ^ 32, 0x85ebca6b);
    } else {
      inWhitespace = false;
      hashA = Math.imul(hashA ^ code, 0x01000193);
      hashB = Math.imul(hashB ^ code, 0x85ebca6b);
    }
    normalizedLength += 1;
  }
  return `${normalizedLength}:${hashA >>> 0}:${hashB >>> 0}`;
}

class BoundedKeySet {
  private readonly values = new Map<string, true>();

  constructor(private readonly capacity = 20_000) {}

  has(value: string): boolean {
    return this.values.has(value);
  }

  add(value: string): void {
    if (!value) return;
    this.values.delete(value);
    this.values.set(value, true);
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
