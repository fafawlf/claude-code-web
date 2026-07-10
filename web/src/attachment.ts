import type { ClientHello, ReplayMode, ServerMessage } from './types';

export type AttachmentPhase = 'connecting' | 'replaying' | 'ready' | 'error';

export type AttachmentViewState = {
  attachId: string;
  phase: AttachmentPhase;
  requestedSessionId?: string;
  targetProviderSessionId?: string;
  targetCwd?: string;
  displaySessionKey: string;
  hasCachedState: boolean;
  replayAfterId: number;
  replayMode?: ReplayMode;
  legacyReplay: boolean;
};

let nextAttachId = 1;

export function createAttachId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `web-${Date.now().toString(36)}-${(nextAttachId++).toString(36)}`;
}

export function withAttachId(hello: ClientHello, attachId = createAttachId()): ClientHello {
  return { ...hello, attachId };
}

export function isMessageForAttachment(
  message: ServerMessage,
  attachment: Pick<AttachmentViewState, 'attachId' | 'requestedSessionId'>,
  activeSessionId: string | null,
): boolean {
  if (message.type === 'sessions_update') return true;
  if (message.attachId && message.attachId !== attachment.attachId) return false;

  // A restored runtime id is only a hint: the server may recover the same
  // provider transcript into a fresh runtime session. In that case the
  // matching attachId is the authoritative response to this hello and the
  // ready frame intentionally carries a new sessionId.
  if (message.type === 'ready' && message.attachId === attachment.attachId) return true;

  const expectedSessionId = activeSessionId ?? attachment.requestedSessionId;
  if (!expectedSessionId) return true;
  const frameSessionId = sessionIdForMessage(message);
  return !frameSessionId || frameSessionId === expectedSessionId;
}

export function replayModeForReady(message: Extract<ServerMessage, { type: 'ready' }>, replayAfterId: number): ReplayMode {
  return message.replayMode ?? (replayAfterId > 0 ? 'delta' : 'full');
}

export function readyUsesExplicitReplay(message: Extract<ServerMessage, { type: 'ready' }>): boolean {
  return message.replayMode !== undefined || message.historyStatus !== undefined;
}

function sessionIdForMessage(message: Exclude<ServerMessage, { type: 'sessions_update' }>): string | undefined {
  if (message.type === 'ready') return message.state.sessionId;
  if (message.type === 'heartbeat') return message.sessionId ?? message.session?.sessionId;
  return message.sessionId;
}
