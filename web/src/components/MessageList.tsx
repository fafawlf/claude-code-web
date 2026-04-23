import { useEffect, useRef } from 'react';
import type { ChatItem } from '../types';
import { ToolUse } from './ToolUse';
import { DiffBlock } from './DiffBlock';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

type Props = {
  items: ChatItem[];
  busy: boolean;
  streamingText: string;
  pendingByToolUseId: Map<string, string>;
  onAcceptEdit: (reqId: string) => void;
  onRejectEdit: (reqId: string) => void;
};

export function MessageList({ items, busy, streamingText, pendingByToolUseId, onAcceptEdit, onRejectEdit }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items.length, busy, streamingText]);

  return (
    <div className="flex-1 overflow-y-auto pb-40">
      <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-[18px]">
        {items.map((it) => <Bubble key={it.id} item={it} pendingByToolUseId={pendingByToolUseId} onAcceptEdit={onAcceptEdit} onRejectEdit={onRejectEdit} />)}
        {streamingText && busy && (
          <div className="animate-fade-up text-text-primary leading-[1.65] whitespace-pre-wrap">
            {streamingText}<span className="cursor-bar" />
          </div>
        )}
        {busy && !streamingText && <div className="animate-fade-up text-sm text-text-muted">Claude is thinking…<span className="cursor-bar ml-1" /></div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

type BubbleProps = { item: ChatItem } & Pick<Props, 'pendingByToolUseId' | 'onAcceptEdit' | 'onRejectEdit'>;

function Bubble({ item, pendingByToolUseId, onAcceptEdit, onRejectEdit }: BubbleProps) {
  if (item.kind === 'user') {
    return (
      <div className="animate-fade-up flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 text-text-primary whitespace-pre-wrap bg-bg-accent-soft border border-accent/15 rounded-[14px_14px_4px_14px]">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant_text') {
    return <div className="animate-fade-up text-text-primary whitespace-pre-wrap leading-[1.65]">{item.text}</div>;
  }
  if (item.kind === 'thinking') {
    return (
      <details className="animate-fade-up text-text-muted text-xs pl-3 border-l-2 border-border cursor-pointer group">
        <summary className="select-none hover:text-text-secondary transition-colors duration-hover list-none">
          <span className="inline-flex items-center gap-1.5">
            <span>Thought for a moment</span>
          </span>
        </summary>
        <div className="mt-1.5 whitespace-pre-wrap text-text-secondary">{item.text}</div>
      </details>
    );
  }
  if (item.kind === 'tool_use') {
    if (EDIT_LIKE.has(item.name)) {
      const pendingReqId = pendingByToolUseId.get(item.toolUseId);
      return <div className="animate-fade-up"><DiffBlock item={item} pendingReqId={pendingReqId} onAccept={onAcceptEdit} onReject={onRejectEdit} /></div>;
    }
    return <div className="animate-fade-up"><ToolUse item={item} /></div>;
  }
  return (
    <div className={`animate-fade-up text-xs px-3 py-2 rounded-sm ${item.level === 'error' ? 'bg-danger/10 text-danger' : 'bg-bg-raised/60 text-text-muted'}`}>{item.text}</div>
  );
}
