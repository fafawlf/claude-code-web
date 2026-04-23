import { randomUUID } from 'node:crypto';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

type Decision = 'approve' | 'reject';

type Pending = {
  reqId: string;
  resolve: (v: Decision) => void;
  timer: NodeJS.Timeout;
};

type Emitter = (req: { reqId: string; plan: string }) => boolean;

const TIMEOUT_MS = 10 * 60 * 1000;

export class PlanBroker {
  private pending = new Map<string, Pending>();
  private emit: Emitter;

  constructor(emit: Emitter) { this.emit = emit; }

  async awaitApproval(plan: string, signal: AbortSignal): Promise<PermissionResult> {
    const reqId = randomUUID();
    const decision = await new Promise<Decision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve('reject');
      }, TIMEOUT_MS);
      const onAbort = () => {
        this.pending.delete(reqId);
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(reqId, { reqId, resolve, timer });

      if (!this.emit({ reqId, plan })) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        resolve('reject');
      }
    });

    if (decision === 'approve') {
      return { behavior: 'allow', updatedInput: { plan } };
    }
    return { behavior: 'deny', message: 'User rejected the plan; staying in plan mode.' };
  }

  resolve(reqId: string, decision: Decision): boolean {
    const p = this.pending.get(reqId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(reqId);
    p.resolve(decision);
    return true;
  }

  drainReject(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve('reject');
    }
    this.pending.clear();
  }
}
