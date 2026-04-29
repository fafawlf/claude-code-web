// Wire protocol between browser and server. The SDK's SDKMessage objects are
// forwarded as-is inside `event` payloads so we don't re-invent a schema for
// every assistant/tool variant.

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type SessionRuntimeStatus = 'idle' | 'running' | 'waiting_permission' | 'waiting_plan' | 'error' | 'closed';
export type AgentProviderId = 'claude' | 'codex';

export const DEFAULT_NODE_ID = 'local';
export const DEFAULT_AGENT_PROVIDER: AgentProviderId = 'claude';

export type ActiveToolInfo = {
  toolUseId: string;
  name: string;
  startedAt: number;
  inputSummary?: string;
};

export type ClientHello = {
  type: 'hello';
  nodeId?: string;
  provider?: AgentProviderId;
  sessionId?: string;
  resumeClaudeId?: string;
  cwd?: string;
  model?: string;
  permissionMode?: PermissionMode;
  lastEventId?: number;
  /** When true, load transcript but do NOT spawn a live Claude Code process.
   *  Safe for peeking at sessions that may be actively running elsewhere. */
  viewerMode?: boolean;
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
export type ClientRefreshHistory = { type: 'refresh_history' };
export type ClientSessionClose = { type: 'session_close'; sessionId: string };
/** Ask for a fresh snapshot of all sessions. Used to populate the
 *  drawer/sidebar on demand. The server no longer broadcasts sessions_update
 *  automatically — that proved fatal on slow links (session-list snapshots
 *  grow with history and fan out per activeTool transition, burying the WS
 *  send queue). Clients request explicitly when they actually want the list. */
export type ClientListSessions = { type: 'list_sessions' };

export type ClientMessage =
  | ClientHello
  | ClientUserMessage
  | ClientPermissionResponse
  | ClientPlanResponse
  | ClientInterrupt
  | ClientSetModel
  | ClientSetMode
  | ClientRefreshHistory
  | ClientSessionClose
  | ClientListSessions;

export type SessionStateSnapshot = {
  sessionId: string;
  nodeId: string;
  nodeLabel?: string;
  provider: AgentProviderId;
  providerSessionId?: string;
  claudeSessionId?: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  runtimeStatus: SessionRuntimeStatus;
  attachedCount: number;
  lastEventId: number;
  lastEventAt: number;
  activeTool?: ActiveToolInfo;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  viewerMode?: boolean;
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
export type PendingControl =
  | ({ kind: 'permission' } & Omit<ServerPermissionRequest, 'type'>)
  | ({ kind: 'plan' } & Omit<ServerPlanProposed, 'type'>);
export type ServerPendingControl = {
  type: 'pending_control';
  sessionId: string;
  control: PendingControl;
};
export type ServerSessionsUpdate = {
  type: 'sessions_update';
  sessions: SessionStateSnapshot[];
};
export type ServerStateUpdate = {
  type: 'state_update';
  state: Partial<SessionStateSnapshot>;
};
export type ServerHeartbeat = {
  type: 'heartbeat';
  now: number;
  session?: SessionStateSnapshot;
  noActivityMs?: number;
};
export type ServerError = { type: 'error'; message: string };

export type ServerMessage =
  | ServerReady
  | ServerSdkEvent
  | ServerSdkEventBatch
  | ServerPermissionRequest
  | ServerPlanProposed
  | ServerPendingControl
  | ServerSessionsUpdate
  | ServerStateUpdate
  | ServerHeartbeat
  | ServerError;
