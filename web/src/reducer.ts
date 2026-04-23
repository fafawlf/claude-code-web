import type { ChatItem, SdkEvent } from './types';

export type ChatState = {
  items: ChatItem[];
  busy: boolean;
  lastEventId: number;
};

export const initialState: ChatState = { items: [], busy: false, lastEventId: 0 };

function id(): string {
  return Math.random().toString(36).slice(2);
}

// Fold one SDK event into UI state. Pragmatic rendering — we don't exhaustively
// reflect the full SDK taxonomy, just the turn-level shapes a user reads.
export function applyEvent(state: ChatState, ev: SdkEvent, eventId: number): ChatState {
  const items = state.items.slice();
  let busy = state.busy;

  if (ev.type === 'assistant' && ev.message?.content) {
    busy = true;
    for (const part of ev.message.content) {
      if (part.type === 'text' && typeof (part as any).text === 'string') {
        items.push({ kind: 'assistant_text', id: id(), text: (part as any).text });
      } else if (part.type === 'thinking' && typeof (part as any).thinking === 'string') {
        items.push({ kind: 'thinking', id: id(), text: (part as any).thinking });
      } else if (part.type === 'tool_use') {
        const p = part as { id: string; name: string; input: Record<string, unknown> };
        items.push({ kind: 'tool_use', id: id(), toolUseId: p.id, name: p.name, input: p.input });
      }
    }
  } else if (ev.type === 'user' && ev.message?.content) {
    // Usually synthetic — tool results are injected as user messages.
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
      } else if ((part as any).type === 'text') {
        // Real user-typed messages are added locally on submit; ignore replays.
      }
    }
  } else if (ev.type === 'result' || (ev.type === 'system' && ev.subtype === 'result')) {
    busy = false;
  } else if (ev.type === 'system' && ev.subtype === 'error') {
    items.push({ kind: 'system', id: id(), text: String((ev as any).message ?? 'error'), level: 'error' });
    busy = false;
  }

  return { items, busy, lastEventId: Math.max(state.lastEventId, eventId) };
}
