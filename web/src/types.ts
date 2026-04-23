// Mirrors of the wire protocol in server/src/protocol.ts.

export type ClientHello = { type: 'hello'; sessionId?: string; resumeClaudeId?: string; cwd?: string; lastEventId?: number };
export type ClientUserMessage = { type: 'user'; text: string };
export type ClientPermissionResponse = { type: 'permission_response'; reqId: string; decision: 'allow' | 'deny'; scope?: 'once' | 'session' };
export type ClientInterrupt = { type: 'interrupt' };
export type ClientMessage = ClientHello | ClientUserMessage | ClientPermissionResponse | ClientInterrupt;

export type ServerReady = { type: 'ready'; sessionId: string };
export type ServerSdkEvent = { type: 'sdk_event'; id: number; event: SdkEvent };
export type ServerPermissionRequest = {
  type: 'permission_request';
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
};
export type ServerError = { type: 'error'; message: string };
export type ServerTurnEnd = { type: 'turn_end' };
export type ServerMessage = ServerReady | ServerSdkEvent | ServerPermissionRequest | ServerError | ServerTurnEnd;

// Loose shape for SDKMessage. We only peek at a few fields for rendering; unknown variants render as JSON.
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
  };
  [k: string]: unknown;
};

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant_text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool_use'; id: string; toolUseId: string; name: string; input: Record<string, unknown>; result?: { content: string; isError: boolean } }
  | { kind: 'system'; id: string; text: string; level: 'info' | 'error' };
