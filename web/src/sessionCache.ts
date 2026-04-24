import type { ChatState } from './reducer';

export function rememberChatState(cache: Map<string, ChatState>, activeSessionId: string | null, state: ChatState): string | null {
  const id = state.state?.sessionId ?? activeSessionId;
  if (!id) return null;
  cache.set(id, state);
  return id;
}

export function cachedLastEventId(cache: Map<string, ChatState>, sessionId: string): number {
  return cache.get(sessionId)?.lastEventId ?? 0;
}
