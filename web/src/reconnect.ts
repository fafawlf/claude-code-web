import type { ChatState } from './reducer';
import type { ClientHello } from './types';

export function buildReconnectHello(activeSessionId: string | null, state: ChatState, lastEventId: number): ClientHello {
  if (!activeSessionId) return { type: 'hello' };
  const snap = state.state;
  return {
    type: 'hello',
    sessionId: activeSessionId,
    lastEventId,
    cwd: snap?.cwd,
    resumeClaudeId: snap?.claudeSessionId,
    model: snap?.model,
    permissionMode: snap?.permissionMode,
    viewerMode: snap?.viewerMode,
  };
}
