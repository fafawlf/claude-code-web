import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import { resolveCodexPath } from './resolveCodexPath.js';
import { DEFAULT_NODE_ID, type PendingControl, type PermissionMode, type SessionRuntimeStatus, type SessionStateSnapshot } from '../protocol.js';
import type { AgentSessionOptions } from './types.js';
import type { ControlListener, EventListener, SessionEvent, StateListener } from '../session/ClaudeSession.js';

const RING_CAPACITY = 5000;

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
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
    this.historyReady = Promise.resolve();
  }

  sendUser(text: string): void {
    if (this.closed || this.state.viewerMode) return;
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
    this.updateState({ runtimeStatus: 'running', activeTool: undefined });

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
      case 'thread.started':
        if (event.thread_id) {
          this.updateState({
            providerSessionId: event.thread_id,
            claudeSessionId: event.thread_id,
          });
        }
        break;
      case 'turn.started':
        this.setRuntimeStatus('running');
        break;
      case 'item.completed':
        this.handleCompletedItem(event.item);
        break;
      case 'turn.completed':
        this.updateUsage(event.usage);
        this.pushEvent({ type: 'result' });
        break;
      case 'error':
        if (event.message && !event.message.startsWith('Reconnecting...')) {
          this.pushEvent({ type: 'system', subtype: 'error', message: event.message });
        }
        break;
    }
  }

  private handleCompletedItem(item: CodexJsonEvent['item']): void {
    if (!item) return;
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      this.pushEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: item.text }] } });
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

  private updateState(delta: Partial<SessionStateSnapshot>): void {
    this.state = { ...this.state, ...delta };
    for (const listener of this.stateListeners) { try { listener(delta); } catch { /* noop */ } }
  }

  private setRuntimeStatus(runtimeStatus: SessionRuntimeStatus): void {
    if (this.state.runtimeStatus === runtimeStatus) return;
    this.updateState({ runtimeStatus });
  }

  private finishTurn(status: SessionRuntimeStatus): void {
    this.running = false;
    this.child = undefined;
    this.setRuntimeStatus(status);
    const next = this.pendingPrompts.shift();
    if (next && !this.closed) this.startTurn(next);
  }
}

function codexToolName(type: string): string {
  if (/command|exec/i.test(type)) return 'Command';
  return 'CodexTool';
}

function tail(value: string, max: number): string {
  return value.length > max ? value.slice(value.length - max) : value;
}
