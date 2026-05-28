import { randomUUID } from 'node:crypto';
import { ClaudeProvider } from '../agents/ClaudeProvider.js';
import { CodexProvider } from '../agents/CodexProvider.js';
import type { AgentProvider, AgentSession } from '../agents/types.js';
import type { PermissionListener, PlanListener } from './ClaudeSession.js';
import type { AgentProviderId, PermissionMode, SessionStateSnapshot } from '../protocol.js';

const MAX_CONCURRENT = 8;
type ManagerListener = (sessions: SessionStateSnapshot[]) => void;

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private subscribers = new Map<string, number>(); // sessionId → attached-WS count
  private unsubs = new Map<string, Array<() => void>>();
  private listeners = new Set<ManagerListener>();
  private providers = new Map<AgentProviderId, AgentProvider>();

  constructor(providers: AgentProvider[] = [new ClaudeProvider(), new CodexProvider()]) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  create(opts: {
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
  }): AgentSession {
    // If at or over the cap, only reap sessions that are closed or clearly idle.
    // Running/waiting background tasks are first-class now and must survive tab
    // switches until the user explicitly closes them.
    if (this.activeCount() >= MAX_CONCURRENT) this.reapAbandoned();
    if (this.activeCount() >= MAX_CONCURRENT) {
      throw new Error(`Concurrent session limit (${MAX_CONCURRENT}) reached. Close a background session first.`);
    }
    const id = randomUUID();
    const provider = this.providerFor(opts.provider ?? 'claude');
    const session = provider.createSession({ id, ...opts });
    this.sessions.set(id, session);
    this.track(id, session);
    this.notify();
    return session;
  }

  get(id: string): AgentSession | undefined { return this.sessions.get(id); }

  getSnapshot(id: string): SessionStateSnapshot | undefined {
    const s = this.sessions.get(id);
    return s ? this.snapshot(s) : undefined;
  }

  findReusableResume(opts: {
    nodeId: string;
    provider: AgentProviderId;
    cwd: string;
    providerSessionId?: string;
    viewerMode?: boolean;
  }): AgentSession | undefined {
    if (!opts.providerSessionId) return undefined;
    let best: AgentSession | undefined;
    for (const session of this.sessions.values()) {
      if (session.isClosed()) continue;
      const snap = session.getState();
      const sameProviderSession =
        snap.providerSessionId === opts.providerSessionId ||
        snap.claudeSessionId === opts.providerSessionId;
      if (!sameProviderSession) continue;
      if (snap.nodeId !== opts.nodeId || snap.provider !== opts.provider || snap.cwd !== opts.cwd) continue;
      if (!!snap.viewerMode !== !!opts.viewerMode) continue;
      if (!best || snap.lastEventId > best.getState().lastEventId || snap.lastEventAt > best.getState().lastEventAt) {
        best = session;
      }
    }
    return best;
  }

  listSnapshots(): SessionStateSnapshot[] {
    return [...this.sessions.values()].map((s) => this.snapshot(s));
  }

  async remove(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.subscribers.delete(id);
    this.unsubs.get(id)?.forEach((u) => { try { u(); } catch { /* */ } });
    this.unsubs.delete(id);
    try { await s.close(); } catch { /* */ }
    this.notify();
  }

  attach(id: string): void {
    this.subscribers.set(id, (this.subscribers.get(id) ?? 0) + 1);
    this.notify();
  }

  detach(id: string): void {
    const n = (this.subscribers.get(id) ?? 0) - 1;
    if (n <= 0) this.subscribers.delete(id);
    else this.subscribers.set(id, n);
    this.notify();
  }

  subscribe(l: ManagerListener): () => void {
    this.listeners.add(l);
    l(this.listSnapshots());
    return () => this.listeners.delete(l);
  }

  private activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.isClosed()) n++;
    return n;
  }

  /** Close closed/idle abandoned sessions when capacity is exhausted. */
  private reapAbandoned(): void {
    for (const [id, session] of this.sessions) {
      if (session.isClosed()) {
        this.sessions.delete(id);
        this.subscribers.delete(id);
        this.unsubs.get(id)?.forEach((u) => { try { u(); } catch { /* */ } });
        this.unsubs.delete(id);
      }
    }
    if (this.activeCount() < MAX_CONCURRENT) return;
    for (const [id, session] of this.sessions) {
      const snap = session.getState();
      const abandoned = (this.subscribers.get(id) ?? 0) === 0;
      const disposable = snap.viewerMode || snap.runtimeStatus === 'idle' || snap.runtimeStatus === 'error';
      if (abandoned && disposable) {
        void session.close();
        this.sessions.delete(id);
        this.subscribers.delete(id);
        this.unsubs.get(id)?.forEach((u) => { try { u(); } catch { /* */ } });
        this.unsubs.delete(id);
        if (this.activeCount() < MAX_CONCURRENT) break;
      }
    }
  }

  private track(id: string, session: AgentSession): void {
    this.unsubs.set(id, [
      session.subscribeState(() => this.notify()),
      session.subscribeControls(() => this.notify()),
    ]);
  }

  private snapshot(session: AgentSession): SessionStateSnapshot {
    return { ...session.getState(), attachedCount: this.subscribers.get(session.id) ?? 0 };
  }

  private providerFor(id: AgentProviderId): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provider ${id} is not available yet on this node`);
    return provider;
  }

  private notify(): void {
    const snapshots = this.listSnapshots();
    for (const l of this.listeners) { try { l(snapshots); } catch { /* */ } }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
    this.sessions.clear();
    this.subscribers.clear();
    this.unsubs.forEach((us) => us.forEach((u) => { try { u(); } catch { /* */ } }));
    this.unsubs.clear();
    this.notify();
  }
}
