import { randomUUID } from 'node:crypto';
import { ClaudeSession, type PermissionListener, type PlanListener } from './ClaudeSession.js';
import type { PermissionMode } from '../protocol.js';

const MAX_CONCURRENT = 8;

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private subscribers = new Map<string, number>(); // sessionId → attached-WS count

  create(opts: {
    cwd: string;
    resume?: string;
    model?: string;
    permissionMode?: PermissionMode;
    viewerMode?: boolean;
    onPermission: PermissionListener;
    onPlan: PlanListener;
  }): ClaudeSession {
    // If at or over the cap, reap any session with no attached subscribers.
    if (this.activeCount() >= MAX_CONCURRENT) this.reapAbandoned();
    if (this.activeCount() >= MAX_CONCURRENT) {
      throw new Error(`Concurrent session limit (${MAX_CONCURRENT}) reached. Close one of your open tabs first.`);
    }
    const id = randomUUID();
    const session = new ClaudeSession({ id, ...opts });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ClaudeSession | undefined { return this.sessions.get(id); }

  async remove(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.subscribers.delete(id);
    try { await s.close(); } catch { /* */ }
  }

  attach(id: string): void {
    this.subscribers.set(id, (this.subscribers.get(id) ?? 0) + 1);
  }

  detach(id: string): void {
    const n = (this.subscribers.get(id) ?? 0) - 1;
    if (n <= 0) this.subscribers.delete(id);
    else this.subscribers.set(id, n);
  }

  private activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.isClosed()) n++;
    return n;
  }

  /** Close sessions that have no attached subscribers AND are over the cap. */
  private reapAbandoned(): void {
    for (const [id, session] of this.sessions) {
      if (session.isClosed()) { this.sessions.delete(id); continue; }
      if ((this.subscribers.get(id) ?? 0) === 0) {
        void session.close();
        this.sessions.delete(id);
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
    this.sessions.clear();
    this.subscribers.clear();
  }
}
