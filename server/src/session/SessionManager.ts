import { randomUUID } from 'node:crypto';
import { ClaudeSession, type PermissionListener, type PlanListener } from './ClaudeSession.js';
import type { PermissionMode, SessionStateSnapshot } from '../protocol.js';

const MAX_CONCURRENT = 8;
type ManagerListener = (sessions: SessionStateSnapshot[]) => void;

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private subscribers = new Map<string, number>(); // sessionId → attached-WS count
  private unsubs = new Map<string, Array<() => void>>();
  private listeners = new Set<ManagerListener>();

  create(opts: {
    cwd: string;
    resume?: string;
    model?: string;
    permissionMode?: PermissionMode;
    viewerMode?: boolean;
    onPermission?: PermissionListener;
    onPlan?: PlanListener;
  }): ClaudeSession {
    // If at or over the cap, only reap sessions that are closed or clearly idle.
    // Running/waiting background tasks are first-class now and must survive tab
    // switches until the user explicitly closes them.
    if (this.activeCount() >= MAX_CONCURRENT) this.reapAbandoned();
    if (this.activeCount() >= MAX_CONCURRENT) {
      throw new Error(`Concurrent session limit (${MAX_CONCURRENT}) reached. Close a background session first.`);
    }
    const id = randomUUID();
    const session = new ClaudeSession({ id, ...opts });
    this.sessions.set(id, session);
    this.track(id, session);
    this.notify();
    return session;
  }

  get(id: string): ClaudeSession | undefined { return this.sessions.get(id); }

  getSnapshot(id: string): SessionStateSnapshot | undefined {
    const s = this.sessions.get(id);
    return s ? this.snapshot(s) : undefined;
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

  private track(id: string, session: ClaudeSession): void {
    this.unsubs.set(id, [
      session.subscribeState(() => this.notify()),
      session.subscribeControls(() => this.notify()),
    ]);
  }

  private snapshot(session: ClaudeSession): SessionStateSnapshot {
    return { ...session.getState(), attachedCount: this.subscribers.get(session.id) ?? 0 };
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
