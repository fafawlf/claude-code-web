// Wire protocol between browser and server. The SDK's SDKMessage objects are
// forwarded as-is inside `event` payloads so we don't re-invent a schema for
// every assistant/tool variant.

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export type ClientHello = {
  type: 'hello';
  sessionId?: string;
  resumeClaudeId?: string;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  lastEventId?: number;
};

export type ClientUserMessage = { type: 'user'; text: string };
export type ClientPermissionResponse = {
  type: 'permission_response';
  reqId: string;
  decision: 'allow' | 'deny';
  scope?: 'once' | 'session';
};
export type ClientPlanResponse = {
  type: 'plan_response';
  reqId: string;
  decision: 'approve' | 'reject';
};
export type ClientInterrupt = { type: 'interrupt' };
export type ClientSetModel = { type: 'set_model'; model: string };
export type ClientSetMode = { type: 'set_permission_mode'; mode: PermissionMode };

export type ClientMessage =
  | ClientHello
  | ClientUserMessage
  | ClientPermissionResponse
  | ClientPlanResponse
  | ClientInterrupt
  | ClientSetModel
  | ClientSetMode;

export type SessionStateSnapshot = {
  sessionId: string;
  claudeSessionId?: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
};

export type ServerReady = { type: 'ready'; state: SessionStateSnapshot };
export type ServerSdkEvent = { type: 'sdk_event'; id: number; event: unknown };
export type ServerSdkEventBatch = { type: 'sdk_events_batch'; events: Array<{ id: number; event: unknown }> };
export type ServerPermissionRequest = {
  type: 'permission_request';
  reqId: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
};
export type ServerPlanProposed = {
  type: 'plan_proposed';
  reqId: string;
  plan: string;
};
export type ServerStateUpdate = {
  type: 'state_update';
  state: Partial<SessionStateSnapshot>;
};
export type ServerError = { type: 'error'; message: string };

export type ServerMessage =
  | ServerReady
  | ServerSdkEvent
  | ServerSdkEventBatch
  | ServerPermissionRequest
  | ServerPlanProposed
  | ServerStateUpdate
  | ServerError;
