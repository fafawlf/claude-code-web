import type { ChatItem } from './types';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function isEditLikeTool(item: Extract<ChatItem, { kind: 'tool_use' }>): boolean {
  return EDIT_LIKE.has(item.name);
}

export function shouldHideToolInTranscript(item: ChatItem): boolean {
  if (item.kind !== 'tool_use') return false;
  if (isEditLikeTool(item)) return false;
  return !!item.result && !item.result.isError;
}
