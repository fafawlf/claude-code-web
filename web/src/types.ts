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

export type ClaudeAuthInfo = {
  source: 'api' | 'account' | 'none' | 'unknown';
  plan?: 'max' | 'pro' | 'unknown';
  label: string;
  detail?: string;
};

export type CodexAuthInfo = {
  source: 'chatgpt' | 'api' | 'none' | 'unknown';
  plan?: 'pro' | 'unknown';
  label: string;
  detail?: string;
};

export type ClaudeExecutableInfo = {
  source: 'env' | 'path' | 'bundled' | 'missing';
  label: string;
  path?: string;
  detail?: string;
};

export type CodexExecutableInfo = {
  source: 'env' | 'path' | 'missing';
  label: string;
  path?: string;
  detail?: string;
  defaultModel?: string;
};

export type NodeInfo = {
  id: string;
  label: string;
  kind: 'local' | 'ssh';
  defaultCwd: string;
  providers: AgentProviderId[];
  connected?: boolean;
};

export type ServerRuntimeInfo = {
  host?: string;
  port?: number;
  platform: string;
  arch: string;
  node: string;
};

export type ServerInfo = {
  cwd: string;
  home: string;
  node?: NodeInfo;
  auth: ClaudeAuthInfo;
  codexAuth?: CodexAuthInfo;
  claude?: ClaudeExecutableInfo;
  codex?: CodexExecutableInfo;
  server?: ServerRuntimeInfo;
};

// Client → server
export type ClientHello = { type: 'hello'; nodeId?: string; provider?: AgentProviderId; sessionId?: string; resumeClaudeId?: string; cwd?: string; model?: string; permissionMode?: PermissionMode; lastEventId?: number; viewerMode?: boolean };
export type ClientUserMessage = { type: 'user'; text: string };
export type ClientPermissionResponse = { type: 'permission_response'; reqId: string; decision: 'allow' | 'deny'; scope?: 'once' | 'session' };
export type ClientPlanResponse = { type: 'plan_response'; reqId: string; decision: 'approve' | 'reject' };
export type ClientInterrupt = { type: 'interrupt' };
export type ClientSetModel = { type: 'set_model'; model: string };
export type ClientSetMode = { type: 'set_permission_mode'; mode: PermissionMode };
export type ClientRefreshHistory = { type: 'refresh_history' };
export type ClientSessionClose = { type: 'session_close'; sessionId: string };
export type ClientMessage = ClientHello | ClientUserMessage | ClientPermissionResponse | ClientPlanResponse | ClientInterrupt | ClientSetModel | ClientSetMode | ClientRefreshHistory | ClientSessionClose;

// Server → client
export type ServerReady = { type: 'ready'; state: SessionStateSnapshot };
export type ServerSdkEvent = { type: 'sdk_event'; id: number; event: SdkEvent };
export type ServerSdkEventBatch = { type: 'sdk_events_batch'; events: Array<{ id: number; event: SdkEvent }> };
export type ServerPermissionRequest = { type: 'permission_request'; reqId: string; toolName: string; toolUseId?: string; input: Record<string, unknown>; title?: string; displayName?: string; description?: string };
export type ServerPlanProposed = { type: 'plan_proposed'; reqId: string; plan: string };
export type PendingControl =
  | ({ kind: 'permission' } & Omit<ServerPermissionRequest, 'type'>)
  | ({ kind: 'plan' } & Omit<ServerPlanProposed, 'type'>);
export type ServerPendingControl = { type: 'pending_control'; sessionId: string; control: PendingControl };
export type ServerSessionsUpdate = { type: 'sessions_update'; sessions: SessionStateSnapshot[] };
export type ServerStateUpdate = { type: 'state_update'; state: Partial<SessionStateSnapshot> };
export type ServerHeartbeat = { type: 'heartbeat'; now: number; session?: SessionStateSnapshot; noActivityMs?: number };
export type ServerError = { type: 'error'; message: string };
export type ServerMessage = ServerReady | ServerSdkEvent | ServerSdkEventBatch | ServerPermissionRequest | ServerPlanProposed | ServerPendingControl | ServerSessionsUpdate | ServerStateUpdate | ServerHeartbeat | ServerError;

export type SdkEvent = {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
      | { type: 'thinking'; thinking?: string }
      | { type: string; [k: string]: unknown }
    >;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  [k: string]: unknown;
};

export type ChatItem =
  | { kind: 'user'; id: string; text: string; optimistic?: boolean }
  | { kind: 'assistant_text'; id: string; text: string; streamed?: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool_use'; id: string; toolUseId: string; name: string; input: Record<string, unknown>; result?: { content: string; isError: boolean } }
  | { kind: 'system'; id: string; text: string; level: 'info' | 'error' };

export type StoredSession = {
  sessionId: string;
  summary?: string;
  customTitle?: string;
  firstPrompt?: string;
  lastModified: number;
  gitBranch?: string;
};

// Models exposed in the UI. Labels are stable display names; ids map to SDK model strings.
export const MODEL_OPTIONS = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7', hint: 'deepest reasoning' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'balanced' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'fastest' },
] as const;

export const CODEX_MODEL_OPTIONS = [
  { id: 'gpt-5.5', label: 'GPT-5.5', hint: 'frontier coding' },
  { id: 'gpt-5.4', label: 'GPT-5.4', hint: 'newer reasoning' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'Codex-optimized' },
  { id: 'gpt-5.2', label: 'GPT-5.2', hint: 'general agent' },
] as const;

export function modelOptionsForProvider(provider: AgentProviderId | undefined) {
  return provider === 'codex' ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS;
}

export function providerLabel(provider: AgentProviderId | undefined): string {
  switch (provider) {
    case 'codex': return 'Codex';
    case 'claude':
    default: return 'Claude Code';
  }
}

export function defaultModelLabel(provider: AgentProviderId | undefined): string {
  return provider === 'codex' ? 'Codex default' : 'default';
}

export function modelLabel(provider: AgentProviderId | undefined, model?: string, fallbackModel?: string): string {
  const effective = model ?? fallbackModel;
  if (!effective) return defaultModelLabel(provider);
  return modelOptionsForProvider(provider).find((m) => effective.startsWith(m.id))?.label ?? effective;
}

// Shift+Tab cycles only through the three non-dangerous modes. bypass is
// available from the command palette / slash command but NOT via
// accidental Tab-cycling, because it auto-approves Bash too.
export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan'];

export function modeLabel(m: PermissionMode): string {
  switch (m) {
    case 'default': return 'default';
    case 'acceptEdits': return 'auto-accept edits';
    case 'plan': return 'plan mode';
    case 'bypassPermissions': return 'bypass permissions';
  }
}

export function modeHint(m: PermissionMode): string {
  switch (m) {
    case 'default': return 'prompt before each tool';
    case 'acceptEdits': return 'auto-allow file edits · Bash still prompts';
    case 'plan': return 'read-only · propose a plan first';
    case 'bypassPermissions': return 'auto-allow EVERYTHING including Bash';
  }
}
