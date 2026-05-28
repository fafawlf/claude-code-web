import type { ChatItem, PermissionMode, SdkEvent, SessionStateSnapshot } from './types';
import { cleanAssistantText } from './assistantText';

export type ChatState = {
  items: ChatItem[];
  busy: boolean;
  lastEventId: number;
  state: SessionStateSnapshot | null;
  streamingText: string;
};

export const initialState: ChatState = {
  items: [],
  busy: false,
  lastEventId: 0,
  state: null,
  streamingText: '',
};

function rid(): string { return Math.random().toString(36).slice(2); }

/**
 * Extract a user text payload from an SDK user event's `content` field.
 * Claude's message content can be either a plain string or an array of parts;
 * we accept either and ignore `tool_result` parts (handled separately).
 */
function extractUserText(content: unknown): string | null {
  if (typeof content === 'string') return content.length ? content : null;
  if (!Array.isArray(content)) return null;
  const buf: string[] = [];
  for (const part of content as any[]) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') buf.push(part.text);
  }
  return buf.length ? buf.join('') : null;
}

/**
 * When an echoed user event arrives, see if there's a recent optimistic item
 * with the same text — if so, "confirm" it instead of appending a duplicate.
 * Searches the tail of items for resilience (last 5 are usually enough).
 */
function absorbOptimistic(items: ChatItem[], text: string): ChatItem[] | null {
  const scan = Math.min(5, items.length);
  for (let i = items.length - 1; i >= items.length - scan && i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'user' && it.optimistic && it.text === text) {
      const copy = items.slice();
      copy[i] = { ...it, optimistic: false };
      return copy;
    }
  }
  return null;
}

export function applyEvent(s: ChatState, ev: SdkEvent, eventId: number): ChatState {
  const items = s.items.slice();
  let busy = s.busy;
  let streamingText = s.streamingText;

  if (ev.type === 'stream_event') {
    const inner = (ev as any).event as { type?: string; delta?: { type?: string; text?: string } };
    if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') {
      streamingText = streamingText + inner.delta.text;
      busy = true;
    } else if (inner?.type === 'message_start') {
      streamingText = '';
      busy = true;
    }
    return { ...s, items, busy, streamingText, lastEventId: Math.max(s.lastEventId, eventId) };
  }

  if (ev.type === 'assistant' && ev.message?.content) {
    const streamedText = streamingText;
    busy = true;
    streamingText = '';
    for (const part of ev.message.content) {
      if (part.type === 'text' && typeof (part as any).text === 'string') {
        const text = cleanAssistantText((part as any).text);
        if (!text) continue;
        items.push({ kind: 'assistant_text', id: rid(), text, streamed: isStreamHandoff(cleanAssistantText(streamedText), text) });
      } else if (part.type === 'thinking' && typeof (part as any).thinking === 'string') {
        items.push({ kind: 'thinking', id: rid(), text: (part as any).thinking });
      } else if (part.type === 'tool_use') {
        const p = part as { id: string; name: string; input: Record<string, unknown> };
        items.push({ kind: 'tool_use', id: rid(), toolUseId: p.id, name: p.name, input: p.input });
      }
    }
  } else if (ev.type === 'user' && ev.message?.content !== undefined) {
    const content = ev.message.content as unknown;
    // 1) First attempt user text extraction (string or text parts). If present,
    //    either absorb the matching optimistic item or append a new one.
    const text = extractUserText(content);
    if (text) {
      const absorbed = absorbOptimistic(items, text);
      if (absorbed) {
        return { ...s, items: absorbed, busy, streamingText, lastEventId: Math.max(s.lastEventId, eventId) };
      }
      items.push({ kind: 'user', id: rid(), text });
    }
    // 2) Then walk for tool_result parts and bind them back to their tool_use.
    if (Array.isArray(content)) {
      for (const part of content as any[]) {
        if (part?.type !== 'tool_result') continue;
        const p = part as { tool_use_id: string; content?: unknown; is_error?: boolean };
        const resultContent = typeof p.content === 'string' ? p.content : JSON.stringify(p.content, null, 2);
        let idx = -1;
        for (let i = items.length - 1; i >= 0; i--) {
          const x = items[i];
          if (x.kind === 'tool_use' && x.toolUseId === p.tool_use_id) { idx = i; break; }
        }
        if (idx >= 0 && items[idx].kind === 'tool_use') {
          const prev = items[idx] as Extract<ChatItem, { kind: 'tool_use' }>;
          items[idx] = { ...prev, result: { content: resultContent ?? '', isError: !!p.is_error } };
        }
      }
    }
  } else if (ev.type === 'result') {
    busy = false;
    streamingText = '';
  } else if (ev.type === 'system' && ev.subtype === 'error') {
    items.push({ kind: 'system', id: rid(), text: String((ev as any).message ?? 'error'), level: 'error' });
    busy = false;
    streamingText = '';
  }

  return { ...s, items, busy, streamingText, lastEventId: Math.max(s.lastEventId, eventId) };
}

function isStreamHandoff(streamingText: string, finalText: string): boolean {
  if (!streamingText || !finalText) return false;
  const a = streamingText.replace(/\s+$/g, '');
  const b = finalText.replace(/\s+$/g, '');
  return a === b;
}

/** Optimistically append a user message on send (replaced when the echo arrives). */
export function addUserOptimistic(s: ChatState, text: string): ChatState {
  return { ...s, items: [...s.items, { kind: 'user', id: rid(), text, optimistic: true }] };
}

export function applyStateDelta(s: ChatState, delta: Partial<SessionStateSnapshot>): ChatState {
  if (!s.state) return s;
  return { ...s, state: { ...s.state, ...delta } };
}

export function withReady(s: ChatState, snap: SessionStateSnapshot): ChatState {
  return { ...s, state: snap };
}

export function settleReplayedHistory(s: ChatState): ChatState {
  if (!s.state || s.state.runtimeStatus === 'running') return s;
  if (!s.busy && !s.streamingText) return s;
  return { ...s, busy: false, streamingText: '' };
}

export function addSystem(s: ChatState, text: string, level: 'info' | 'error' = 'info'): ChatState {
  return { ...s, items: [...s.items, { kind: 'system', id: rid(), text, level }] };
}

export function resetSession(_model?: string, _mode?: PermissionMode): ChatState {
  return { ...initialState };
}
