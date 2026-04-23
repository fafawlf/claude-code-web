import type { ChatItem, PermissionMode, SdkEvent, SessionStateSnapshot } from './types';

export type ChatState = {
  items: ChatItem[];
  busy: boolean;
  lastEventId: number;
  state: SessionStateSnapshot | null;
};

export const initialState: ChatState = {
  items: [],
  busy: false,
  lastEventId: 0,
  state: null,
};

function rid(): string { return Math.random().toString(36).slice(2); }

export function applyEvent(s: ChatState, ev: SdkEvent, eventId: number): ChatState {
  const items = s.items.slice();
  let busy = s.busy;

  if (ev.type === 'assistant' && ev.message?.content) {
    busy = true;
    for (const part of ev.message.content) {
      if (part.type === 'text' && typeof (part as any).text === 'string') {
        items.push({ kind: 'assistant_text', id: rid(), text: (part as any).text });
      } else if (part.type === 'thinking' && typeof (part as any).thinking === 'string') {
        items.push({ kind: 'thinking', id: rid(), text: (part as any).thinking });
      } else if (part.type === 'tool_use') {
        const p = part as { id: string; name: string; input: Record<string, unknown> };
        items.push({ kind: 'tool_use', id: rid(), toolUseId: p.id, name: p.name, input: p.input });
      }
    }
  } else if (ev.type === 'user' && ev.message?.content) {
    for (const part of ev.message.content) {
      if ((part as any).type === 'tool_result') {
        const p = part as { tool_use_id: string; content?: unknown; is_error?: boolean };
        const content = typeof p.content === 'string' ? p.content : JSON.stringify(p.content, null, 2);
        let idx = -1;
        for (let i = items.length - 1; i >= 0; i--) {
          const x = items[i];
          if (x.kind === 'tool_use' && x.toolUseId === p.tool_use_id) { idx = i; break; }
        }
        if (idx >= 0 && items[idx].kind === 'tool_use') {
          const prev = items[idx] as Extract<ChatItem, { kind: 'tool_use' }>;
          items[idx] = { ...prev, result: { content: content ?? '', isError: !!p.is_error } };
        }
      }
    }
  } else if (ev.type === 'result') {
    busy = false;
  } else if (ev.type === 'system' && ev.subtype === 'error') {
    items.push({ kind: 'system', id: rid(), text: String((ev as any).message ?? 'error'), level: 'error' });
    busy = false;
  }

  return { ...s, items, busy, lastEventId: Math.max(s.lastEventId, eventId) };
}

export function applyStateDelta(s: ChatState, delta: Partial<SessionStateSnapshot>): ChatState {
  if (!s.state) return s;
  return { ...s, state: { ...s.state, ...delta } };
}

export function withReady(s: ChatState, snap: SessionStateSnapshot): ChatState {
  return { ...s, state: snap };
}

export function addSystem(s: ChatState, text: string, level: 'info' | 'error' = 'info'): ChatState {
  return { ...s, items: [...s.items, { kind: 'system', id: rid(), text, level }] };
}

export function addUser(s: ChatState, text: string): ChatState {
  return { ...s, items: [...s.items, { kind: 'user', id: rid(), text }] };
}

export function resetSession(model?: string, mode?: PermissionMode): ChatState {
  return { ...initialState, state: null };
}
