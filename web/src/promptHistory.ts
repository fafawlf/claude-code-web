export type HistoryDirection = 'up' | 'down';

export type PromptHistoryNavState = {
  items: string[];
  cursor: number | null;
  draft: string;
  value: string;
};

export function recordPrompt(history: string[], prompt: string, limit = 50): string[] {
  const text = prompt.trim();
  if (!text) return history;
  const deduped = history.filter((item) => item !== text);
  return [...deduped, text].slice(-limit);
}

export function shouldHandlePromptHistoryKey(args: {
  key: string;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  popupOpen: boolean;
}): HistoryDirection | null {
  if (args.popupOpen) return null;
  if (args.key !== 'ArrowUp' && args.key !== 'ArrowDown') return null;
  if (args.selectionStart !== args.selectionEnd) return null;
  if (args.text.length === 0) return args.key === 'ArrowUp' ? 'up' : 'down';

  if (args.key === 'ArrowUp') {
    const before = args.text.slice(0, args.selectionStart);
    return before.includes('\n') ? null : 'up';
  }
  const after = args.text.slice(args.selectionEnd);
  return after.includes('\n') ? null : 'down';
}

export function navigatePromptHistory(state: PromptHistoryNavState, direction: HistoryDirection): PromptHistoryNavState | null {
  if (state.items.length === 0) return null;

  if (direction === 'up') {
    if (state.cursor === null) {
      const cursor = state.items.length - 1;
      return { ...state, cursor, draft: state.value, value: state.items[cursor] };
    }
    if (state.cursor > 0) {
      const cursor = state.cursor - 1;
      return { ...state, cursor, value: state.items[cursor] };
    }
    return null;
  }

  if (state.cursor === null) return null;
  if (state.cursor < state.items.length - 1) {
    const cursor = state.cursor + 1;
    return { ...state, cursor, value: state.items[cursor] };
  }
  return { ...state, cursor: null, draft: '', value: state.draft };
}
