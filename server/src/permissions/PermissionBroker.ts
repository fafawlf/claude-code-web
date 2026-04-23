import { randomUUID, createHash } from 'node:crypto';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

type PermissionDecision = { decision: 'allow' | 'deny'; scope?: 'once' | 'session' };

type Pending = {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (v: PermissionDecision) => void;
  timer: NodeJS.Timeout;
};

type Emitter = (req: {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
}) => boolean; // returns true if something is listening

const TIMEOUT_MS = 5 * 60 * 1000;

function fingerprint(toolName: string, input: Record<string, unknown>): string {
  // A coarse identity for "allow for session" — same tool + same input shape.
  return createHash('sha256')
    .update(toolName)
    .update('\0')
    .update(JSON.stringify(input))
    .digest('hex');
}

export class PermissionBroker {
  private pending = new Map<string, Pending>();
  private sessionAllowlist = new Set<string>();
  private emit: Emitter;

  constructor(emit: Emitter) {
    this.emit = emit;
  }

  /** Called by the SDK for every tool-use. */
  async request(
    toolName: string,
    input: Record<string, unknown>,
    meta: { title?: string; displayName?: string; description?: string; signal: AbortSignal }
  ): Promise<PermissionResult> {
    if (this.sessionAllowlist.has(fingerprint(toolName, input))) {
      return { behavior: 'allow', updatedInput: input };
    }

    const reqId = randomUUID();
    const decision = await new Promise<PermissionDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve({ decision: 'deny' });
      }, TIMEOUT_MS);

      const onAbort = () => {
        this.pending.delete(reqId);
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      if (meta.signal.aborted) return onAbort();
      meta.signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(reqId, { reqId, toolName, input, resolve, timer });

      const delivered = this.emit({
        reqId,
        toolName,
        input,
        title: meta.title,
        displayName: meta.displayName,
        description: meta.description,
      });
      if (!delivered) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        resolve({ decision: 'deny' });
      }
    });

    if (decision.decision === 'allow') {
      if (decision.scope === 'session') {
        this.sessionAllowlist.add(fingerprint(toolName, input));
      }
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'User declined this tool call.' };
  }

  resolve(reqId: string, decision: PermissionDecision): boolean {
    const p = this.pending.get(reqId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(reqId);
    p.resolve(decision);
    return true;
  }

  /** Reject every outstanding request — used when the WS disconnects or session dies. */
  drainDeny(reason = 'Connection lost'): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ decision: 'deny' });
    }
    this.pending.clear();
  }
}
