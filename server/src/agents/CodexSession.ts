import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import { resolveCodexPath } from './resolveCodexPath.js';
import { DEFAULT_NODE_ID, type ActiveToolInfo, type PendingControl, type PermissionMode, type SessionRuntimeStatus, type SessionStateSnapshot } from '../protocol.js';
import type { AgentSessionOptions } from './types.js';
import type { ControlListener, EventListener, SessionEvent, StateListener } from '../session/ClaudeSession.js';

const RING_CAPACITY = 5000;

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
  private ring: SessionEvent[] = [];
  private listeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private controlListeners = new Set<ControlListener>();
  private stderrTail = '';
  private activeTurn?: ActiveToolInfo;
  private historyReadyResolve!: () => void;
  private seenAssistantTexts = new Set<string>();
  private seenUserTexts = new Set<string>();
  private seenToolCalls = new Set<string>();
  private seenToolResults = new Set<string>();
  private resultPushedForTurn = false;

  constructor(opts: AgentSessionOptions) {
    this.id = opts.id;
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
    this.historyReady = new Promise<void>((resolve) => { this.historyReadyResolve = resolve; });
    if (opts.resume) void this.loadHistory(opts.resume);
    else this.historyReadyResolve();
  }

  sendUser(text: string): void {
    if (this.closed || this.state.viewerMode) return;
    this.seenUserTexts.add(normalizeForDedupe(text));
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
    return 0;
  }

  isViewer(): boolean { return !!this.state.viewerMode; }
  isClosed(): boolean { return this.closed; }

  async close(): Promise<void> {
    this.closed = true;
    this.pendingPrompts = [];
    try { this.child?.kill('SIGTERM'); } catch { /* best effort */ }
    this.permissionBroker.drainDeny();
    this.planBroker.drainReject();
    this.updateState({ runtimeStatus: 'closed', activeTool: undefined });
  }

  getState(): SessionStateSnapshot {
    return { ...this.state };
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
    const child = spawn(codexPath, args, {
      cwd: this.state.cwd,
      env: process.env,
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
    const se: SessionEvent = { id, event };
    this.ring.push(se);
    if (this.ring.length > RING_CAPACITY) this.ring.shift();
    for (const listener of this.listeners) { try { listener(se); } catch { /* noop */ } }
  }

  private pushUserText(text: string): void {
    const normalized = normalizeForDedupe(text);
    if (!normalized || this.seenUserTexts.has(normalized)) return;
    this.seenUserTexts.add(normalized);
    this.pushEvent({ type: 'user', message: { role: 'user', content: text } });
  }

  private pushAssistantText(text: string): void {
    const normalized = normalizeForDedupe(text);
    if (!normalized || this.seenAssistantTexts.has(normalized)) return;
    this.seenAssistantTexts.add(normalized);
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
    try {
      const file = findCodexSessionFile(resumeId);
      if (!file) return;
      const lines = readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
      for (const line of lines) this.parseJsonLine(line, (event) => this.handleCodexEvent(event));
    } finally {
      if (!this.running && this.state.runtimeStatus === 'running') {
        this.updateState({ runtimeStatus: 'idle', activeTool: undefined });
      }
      this.historyReadyResolve();
    }
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

function normalizeForDedupe(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function findCodexSessionFile(sessionId: string): string | undefined {
  const root = join(codexHome(), 'sessions');
  if (!existsSync(root)) return undefined;
  let best: { path: string; mtime: number } | undefined;
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && basename(entry.name).includes(sessionId)) {
        const mtime = statSync(path).mtimeMs;
        if (!best || mtime >= best.mtime) best = { path, mtime };
      }
    }
  };
  walk(root, 0);
  return best?.path;
}
