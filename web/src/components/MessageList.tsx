import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatItem } from '../types';
import { ToolUse } from './ToolUse';
import { DiffBlock } from './DiffBlock';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STICK_THRESHOLD = 80; // px from bottom still counts as "at bottom"

type Props = {
  items: ChatItem[];
  busy: boolean;
  streamingText: string;
  pendingByToolUseId: Map<string, string>;
  onAcceptEdit: (reqId: string) => void;
  onRejectEdit: (reqId: string) => void;
};

function MessageListImpl({ items, busy, streamingText, pendingByToolUseId, onAcceptEdit, onRejectEdit }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Detect whether the user has scrolled up to read earlier messages. We only
  // auto-scroll when they're already at (or near) the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll on new message (items count change) only. Not on stream deltas.
  // Use layout effect + instant behavior — "smooth" looks laggy when 900
  // replayed items arrive in a single batch.
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [items.length]);

  // During streaming, keep the tail in view only if user is already at bottom.
  // Use the CSS scroll-margin anchor via direct scrollTop for minimal cost.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingText, busy]);

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto pb-40">
      <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-[18px]">
        {items.map((it) => <Bubble key={it.id} item={it} pendingByToolUseId={pendingByToolUseId} onAcceptEdit={onAcceptEdit} onRejectEdit={onRejectEdit} />)}
        {streamingText && busy && (
          <div className="text-text-primary leading-[1.65] whitespace-pre-wrap">
            {streamingText}<span className="cursor-bar" />
          </div>
        )}
        {busy && !streamingText && <div className="text-sm text-text-muted">Claude is thinking…<span className="cursor-bar ml-1" /></div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export const MessageList = memo(MessageListImpl);

type BubbleProps = { item: ChatItem } & Pick<Props, 'pendingByToolUseId' | 'onAcceptEdit' | 'onRejectEdit'>;

function Bubble({ item, pendingByToolUseId, onAcceptEdit, onRejectEdit }: BubbleProps) {
  if (item.kind === 'user') {
    return (
      <div className={`animate-fade-up flex justify-end ${item.optimistic ? 'opacity-85' : ''}`}>
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
