import { ClaudeSession } from '../session/ClaudeSession.js';
import type { AgentProvider, AgentSession, AgentSessionOptions } from './types.js';

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const;
  readonly label = 'Claude Code';

  createSession(opts: AgentSessionOptions): AgentSession {
    return new ClaudeSession({ ...opts, provider: this.id });
  }
}
