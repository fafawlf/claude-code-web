import { useEffect, useRef } from 'react';
import type { ChatItem } from '../types';
import { ToolUse } from './ToolUse';

type Props = { items: ChatItem[]; busy: boolean };

export function MessageList({ items, busy }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items.length, busy]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {items.length === 0 && (
          <div className="text-zinc-500 text-sm">Say something to start. Claude Code runs on the remote machine; output streams here.</div>
        )}
        {items.map((it) => <Bubble key={it.id} item={it} />)}
        {busy && <div className="text-xs text-zinc-500 animate-pulse">Claude is working…</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-blue-600/90 text-white whitespace-pre-wrap">{item.text}</div>
      </div>
    );
  }
  if (item.kind === 'assistant_text') {
    return (
      <div className="text-zinc-100 whitespace-pre-wrap leading-relaxed">{item.text}</div>
    );
  }
  if (item.kind === 'thinking') {
    return (
      <details className="text-zinc-500 text-xs bg-zinc-900/50 rounded px-3 py-2">
        <summary className="cursor-pointer select-none">thinking</summary>
        <div className="mt-1 whitespace-pre-wrap">{item.text}</div>
      </details>
    );
  }
  if (item.kind === 'tool_use') {
    return <ToolUse item={item} />;
  }
  return (
    <div className={`text-xs px-3 py-2 rounded ${item.level === 'error' ? 'bg-red-950/50 text-red-300' : 'bg-zinc-900/60 text-zinc-400'}`}>{item.text}</div>
  );
}
