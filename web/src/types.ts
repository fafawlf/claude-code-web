export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

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

// Client → server
export type ClientHello = { type: 'hello'; sessionId?: string; resumeClaudeId?: string; cwd?: string; model?: string; permissionMode?: PermissionMode; lastEventId?: number };
export type ClientUserMessage = { type: 'user'; text: string };
export type ClientPermissionResponse = { type: 'permission_response'; reqId: string; decision: 'allow' | 'deny'; scope?: 'once' | 'session' };
export type ClientPlanResponse = { type: 'plan_response'; reqId: string; decision: 'approve' | 'reject' };
export type ClientInterrupt = { type: 'interrupt' };
export type ClientSetModel = { type: 'set_model'; model: string };
export type ClientSetMode = { type: 'set_permission_mode'; mode: PermissionMode };
export type ClientMessage = ClientHello | ClientUserMessage | ClientPermissionResponse | ClientPlanResponse | ClientInterrupt | ClientSetModel | ClientSetMode;

// Server → client
export type ServerReady = { type: 'ready'; state: SessionStateSnapshot };
export type ServerSdkEvent = { type: 'sdk_event'; id: number; event: SdkEvent };
export type ServerPermissionRequest = { type: 'permission_request'; reqId: string; toolName: string; toolUseId?: string; input: Record<string, unknown>; title?: string; displayName?: string; description?: string };
export type ServerPlanProposed = { type: 'plan_proposed'; reqId: string; plan: string };
export type ServerStateUpdate = { type: 'state_update'; state: Partial<SessionStateSnapshot> };
export type ServerError = { type: 'error'; message: string };
export type ServerMessage = ServerReady | ServerSdkEvent | ServerPermissionRequest | ServerPlanProposed | ServerStateUpdate | ServerError;

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
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant_text'; id: string; text: string }
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

export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan'];

export function modeLabel(m: PermissionMode): string {
  switch (m) {
    case 'default': return 'default';
    case 'acceptEdits': return 'auto-accept edits';
    case 'plan': return 'plan mode';
    case 'bypassPermissions': return 'bypass (unsafe)';
  }
}
