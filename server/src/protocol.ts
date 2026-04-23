// Wire protocol between browser and server. Kept narrow — the SDK's SDKMessage
// objects are forwarded as-is inside `event` payloads so we don't re-invent a
// schema for every assistant/tool variant.

export type ClientHello = {
  type: 'hello';
  sessionId?: string; // omit to start a new session
  resumeClaudeId?: string; // optional — resume a prior Claude Code session
  cwd?: string;
  lastEventId?: number; // for reconnect replay
};

export type ClientUserMessage = {
  type: 'user';
  text: string;
};

export type ClientPermissionResponse = {
  type: 'permission_response';
  reqId: string;
  decision: 'allow' | 'deny';
  scope?: 'once' | 'session';
};

export type ClientInterrupt = {
  type: 'interrupt';
};

export type ClientMessage =
  | ClientHello
  | ClientUserMessage
  | ClientPermissionResponse
  | ClientInterrupt;

export type ServerReady = {
  type: 'ready';
  sessionId: string; // our stable id (matches Claude session id once known)
};

export type ServerSdkEvent = {
  type: 'sdk_event';
  id: number; // monotonic per session
  event: unknown; // an SDKMessage
};

export type ServerPermissionRequest = {
  type: 'permission_request';
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
};

export type ServerError = {
  type: 'error';
  message: string;
};

export type ServerTurnEnd = {
  type: 'turn_end';
};

export type ServerMessage =
  | ServerReady
  | ServerSdkEvent
  | ServerPermissionRequest
  | ServerError
  | ServerTurnEnd;
