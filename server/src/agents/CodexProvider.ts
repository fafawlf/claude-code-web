import { CodexSession } from './CodexSession.js';
import type { AgentProvider, AgentSession, AgentSessionOptions } from './types.js';

export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const;
  readonly label = 'Codex';

  createSession(opts: AgentSessionOptions): AgentSession {
    return new CodexSession(opts);
  }
}
