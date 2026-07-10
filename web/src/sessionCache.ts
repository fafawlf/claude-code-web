import { initialState, type ChatState } from './reducer';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type AgentProviderId, type SessionStateSnapshot } from './types';

const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export type SessionIdentity = {
  sessionId?: string;
  nodeId?: string;
  provider?: AgentProviderId;
  cwd?: string;
  providerSessionId?: string;
  claudeSessionId?: string;
};

type CacheEntry = {
  id: number;
  keys: Set<string>;
  state: ChatState;
  bytes: number;
};

/**
 * A small, byte-bounded LRU. Runtime session ids are aliases for the stable
 * provider transcript identity, so a reaped/recreated viewer can reuse the
 * same visible conversation without keeping duplicate copies in memory.
 */
export class SessionCache extends Map<string, ChatState> {
  private readonly maxSessions: number;
  private readonly maxBytes: number;
  private readonly cacheEntries = new Map<number, CacheEntry>();
  private readonly aliases = new Map<string, number>();
  private nextId = 1;
  private totalBytesValue = 0;

  constructor(opts: { maxSessions?: number; maxBytes?: number } = {}) {
    super();
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  override get size(): number {
    return this.cacheEntries.size;
  }

  get totalBytes(): number {
    return this.totalBytesValue;
  }

  override get(key: string): ChatState | undefined {
    const entry = this.entryForKey(key);
    if (!entry) return undefined;
    this.touch(entry);
    return entry.state;
  }

  override has(key: string): boolean {
    return !!this.entryForKey(key);
  }

  override set(key: string, state: ChatState): this {
    this.store([key], state);
    return this;
  }

  override delete(key: string): boolean {
    const entry = this.entryForKey(key);
    if (!entry) return false;
    this.remove(entry);
    return true;
  }

  override clear(): void {
    this.cacheEntries.clear();
    this.aliases.clear();
    this.totalBytesValue = 0;
  }

  remember(activeSessionId: string | null, state: ChatState): string | null {
    const identity = state.state;
    if (!identity && state.items.length === 0 && state.lastEventId === 0) return null;
    const keys = identity ? cacheKeys(identity) : activeSessionId ? [activeSessionId] : [];
    if (keys.length === 0) return null;
    this.store(keys, state);
    return identity ? displaySessionKey(identity) : activeSessionId;
  }

  getFor(session: string | SessionIdentity): ChatState | undefined {
    if (typeof session === 'string') {
      const direct = this.get(session);
      if (direct) return direct;
      const matching = [...this.cacheEntries.values()].filter((entry) => entry.state.state?.sessionId === session);
      if (matching.length !== 1) return undefined;
      this.touch(matching[0]);
      return matching[0].state;
    }
    for (const key of cacheKeys(session)) {
      const state = this.get(key);
      if (state) return state;
    }
    return undefined;
  }

  forget(session: string | SessionIdentity): void {
    if (typeof session === 'string') {
      const direct = this.entryForKey(session);
      if (direct) {
        this.remove(direct);
        return;
      }
      const matching = [...this.cacheEntries.values()].filter((entry) => entry.state.state?.sessionId === session);
      if (matching.length === 1) this.remove(matching[0]);
      return;
    }
    for (const key of cacheKeys(session)) {
      const entry = this.entryForKey(key);
      if (entry) {
        this.remove(entry);
        return;
      }
    }
  }

  private store(keys: string[], state: ChatState): void {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    if (uniqueKeys.length === 0) return;
    const existing = uniqueKeys.map((key) => this.entryForKey(key)).find((entry): entry is CacheEntry => !!entry);
    const bytes = estimateChatStateBytes(state, existing);

    if (bytes > this.maxBytes) {
      if (existing) this.remove(existing);
      return;
    }

    const entry = existing ?? { id: this.nextId++, keys: new Set<string>(), state, bytes: 0 };
    if (existing) this.totalBytesValue -= existing.bytes;
    entry.state = state;
    entry.bytes = bytes;
    this.totalBytesValue += bytes;

    for (const key of uniqueKeys) {
      const collided = this.entryForKey(key);
      if (collided && collided !== entry) this.remove(collided);
      entry.keys.add(key);
      this.aliases.set(key, entry.id);
    }
    this.touch(entry);
    this.evict();
  }

  private entryForKey(key: string): CacheEntry | undefined {
    const id = this.aliases.get(key);
    return id === undefined ? undefined : this.cacheEntries.get(id);
  }

  private touch(entry: CacheEntry): void {
    this.cacheEntries.delete(entry.id);
    this.cacheEntries.set(entry.id, entry);
  }

  private remove(entry: CacheEntry): void {
    if (!this.cacheEntries.delete(entry.id)) return;
    this.totalBytesValue -= entry.bytes;
    for (const key of entry.keys) {
      if (this.aliases.get(key) === entry.id) this.aliases.delete(key);
    }
  }

  private evict(): void {
    while (this.cacheEntries.size > this.maxSessions || this.totalBytesValue > this.maxBytes) {
      const oldest = this.cacheEntries.values().next().value as CacheEntry | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
  }
}

export type ChatStateCache = Map<string, ChatState> | SessionCache;

export function rememberChatState(cache: ChatStateCache, activeSessionId: string | null, state: ChatState): string | null {
  if (cache instanceof SessionCache) return cache.remember(activeSessionId, state);
  const id = state.state ? sessionCacheKey(state.state) : activeSessionId;
  if (!id) return null;
  cache.set(id, state);
  return id;
}

export function cachedLastEventId(cache: ChatStateCache, session: string | SessionIdentity): number {
  return cachedChatState(cache, session)?.lastEventId ?? 0;
}

export function cachedChatState(cache: ChatStateCache, session: string | SessionIdentity): ChatState | undefined {
  if (cache instanceof SessionCache) return cache.getFor(session);
  const key = typeof session === 'string' ? session : session.sessionId ? sessionCacheKey(session as Required<Pick<SessionStateSnapshot, 'sessionId' | 'nodeId' | 'provider'>>) : undefined;
  if (!key) return undefined;
  return cache.get(key) ?? (typeof session === 'string' ? undefined : session.sessionId ? cache.get(session.sessionId) : undefined);
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

export function forgetChatState(cache: ChatStateCache, session: string | SessionIdentity): void {
  if (cache instanceof SessionCache) {
    cache.forget(session);
    return;
  }
  const key = typeof session === 'string' ? session : session.sessionId ? sessionCacheKey(session as Required<Pick<SessionStateSnapshot, 'sessionId' | 'nodeId' | 'provider'>>) : undefined;
  if (!key) return;
  cache.delete(key);
  if (typeof session !== 'string' && session.sessionId) cache.delete(session.sessionId);
}

export function sessionCacheKey(session: Pick<SessionStateSnapshot, 'sessionId' | 'nodeId' | 'provider'>): string {
  return `${session.nodeId ?? DEFAULT_NODE_ID}:${session.provider ?? DEFAULT_AGENT_PROVIDER}:${session.sessionId}`;
}

export function transcriptCacheKey(session: SessionIdentity): string | null {
  const providerSessionId = session.providerSessionId ?? session.claudeSessionId;
  if (!providerSessionId || !session.cwd) return null;
  return JSON.stringify([
    session.nodeId ?? DEFAULT_NODE_ID,
    session.provider ?? DEFAULT_AGENT_PROVIDER,
    session.cwd,
    providerSessionId,
  ]);
}

export function displaySessionKey(session: SessionIdentity): string {
  return transcriptCacheKey(session)
    ?? (session.sessionId ? sessionCacheKey({
      sessionId: session.sessionId,
      nodeId: session.nodeId ?? DEFAULT_NODE_ID,
      provider: session.provider ?? DEFAULT_AGENT_PROVIDER,
    }) : 'session:pending');
}

function cacheKeys(session: SessionIdentity): string[] {
  const keys: string[] = [];
  const transcript = transcriptCacheKey(session);
  if (transcript) keys.push(transcript);
  if (session.sessionId) keys.push(sessionCacheKey({
    sessionId: session.sessionId,
    nodeId: session.nodeId ?? DEFAULT_NODE_ID,
    provider: session.provider ?? DEFAULT_AGENT_PROVIDER,
  }));
  return keys;
}

function estimateChatStateBytes(state: ChatState, previous?: CacheEntry): number {
  if (previous?.state.items === state.items) {
    return Math.max(0, previous.bytes + (state.streamingText.length - previous.state.streamingText.length) * 2);
  }

  if (previous && state.items.length > previous.state.items.length) {
    const previousLength = previous.state.items.length;
    const sharesPrefix = previousLength === 0
      || (state.items[0] === previous.state.items[0] && state.items[previousLength - 1] === previous.state.items[previousLength - 1]);
    if (sharesPrefix) {
      let bytes = previous.bytes + (state.streamingText.length - previous.state.streamingText.length) * 2;
      for (let i = previousLength; i < state.items.length; i++) bytes += estimateChatItemBytes(state.items[i]);
      return Math.max(0, bytes);
    }
  }

  let bytes = (state.streamingText.length + 256) * 2;
  for (const item of state.items) bytes += estimateChatItemBytes(item);
  return bytes;
}

function estimateChatItemBytes(item: ChatState['items'][number]): number {
  let chars = 96;
  if (item.kind === 'user' || item.kind === 'assistant_text' || item.kind === 'thinking' || item.kind === 'system') {
    chars += item.text.length;
  } else {
    chars += item.name.length + JSON.stringify(item.input).length + (item.result?.content.length ?? 0);
  }
  return chars * 2;
}
