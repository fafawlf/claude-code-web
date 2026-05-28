import { initialState, type ChatState } from './reducer';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type SessionStateSnapshot } from './types';

export function rememberChatState(cache: Map<string, ChatState>, activeSessionId: string | null, state: ChatState): string | null {
  const id = state.state ? sessionCacheKey(state.state) : activeSessionId;
  if (!id) return null;
  cache.set(id, state);
  return id;
}

export function cachedLastEventId(cache: Map<string, ChatState>, session: string | SessionStateSnapshot): number {
  return cachedChatState(cache, session)?.lastEventId ?? 0;
}

export function cachedChatState(cache: Map<string, ChatState>, session: string | SessionStateSnapshot): ChatState | undefined {
  const key = typeof session === 'string' ? session : sessionCacheKey(session);
  return cache.get(key) ?? (typeof session === 'string' ? undefined : cache.get(session.sessionId));
}

export function chatStateForReady(current: ChatState, cached: ChatState | undefined, session: SessionStateSnapshot): ChatState {
  if (cached && cached.items.length > 0) return cached;
  if (canCarryCurrentChatState(current, session)) {
    return { ...current, busy: false, streamingText: '' };
  }
  return cached ?? { ...initialState };
}

export function canCarryCurrentChatState(current: ChatState, session: SessionStateSnapshot): boolean {
  const cur = current.state;
  if (!cur || current.items.length === 0) return false;
  const currentProviderSession = cur.providerSessionId ?? cur.claudeSessionId;
  const nextProviderSession = session.providerSessionId ?? session.claudeSessionId;
  if (!currentProviderSession || !nextProviderSession || currentProviderSession !== nextProviderSession) return false;
  return cur.nodeId === session.nodeId && cur.provider === session.provider && cur.cwd === session.cwd;
}

export function forgetChatState(cache: Map<string, ChatState>, session: string | SessionStateSnapshot): void {
  const key = typeof session === 'string' ? session : sessionCacheKey(session);
  cache.delete(key);
  if (typeof session !== 'string') cache.delete(session.sessionId);
}

export function sessionCacheKey(session: Pick<SessionStateSnapshot, 'sessionId' | 'nodeId' | 'provider'>): string {
  return `${session.nodeId ?? DEFAULT_NODE_ID}:${session.provider ?? DEFAULT_AGENT_PROVIDER}:${session.sessionId}`;
}
