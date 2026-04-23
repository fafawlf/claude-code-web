import { randomUUID } from 'node:crypto';
import { ClaudeSession, type PermissionListener } from './ClaudeSession.js';

const MAX_CONCURRENT = 3;

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();

  create(opts: { cwd: string; resume?: string; onPermission: PermissionListener }): ClaudeSession {
    if (this.activeCount() >= MAX_CONCURRENT) {
      throw new Error(`Concurrent session limit (${MAX_CONCURRENT}) reached. Close a session first.`);
    }
    const id = randomUUID();
    const session = new ClaudeSession({ id, cwd: opts.cwd, resume: opts.resume, onPermission: opts.onPermission });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ClaudeSession | undefined {
    return this.sessions.get(id);
  }

  private activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (!s.isClosed()) n++;
    return n;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
    this.sessions.clear();
  }
}
