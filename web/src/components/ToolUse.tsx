import { useState } from 'react';
import type { ChatItem } from '../types';

type Props = { item: Extract<ChatItem, { kind: 'tool_use' }> };

export function ToolUse({ item }: Props) {
  const [open, setOpen] = useState(false);
  const hasResult = !!item.result;
  const isError = item.result?.isError;

  // Highlight bash commands so they stand out.
  const primary = prettyPrimary(item.name, item.input);

  return (
    <div className={`rounded-lg border ${isError ? 'border-red-900/70 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/40'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${isError ? 'text-red-400' : 'text-emerald-400'}`}>{item.name}</span>
        <span className="font-mono text-xs text-zinc-300 truncate">{primary}</span>
        <span className="ml-auto text-[10px] text-zinc-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <pre className="text-xs bg-zinc-950/60 rounded p-2 overflow-x-auto text-zinc-300">{JSON.stringify(item.input, null, 2)}</pre>
          {hasResult && (
            <pre className={`text-xs rounded p-2 overflow-x-auto whitespace-pre-wrap ${isError ? 'bg-red-950/40 text-red-200' : 'bg-zinc-950/60 text-zinc-300'}`}>{item.result!.content}</pre>
          )}
          {!hasResult && <div className="text-xs text-zinc-500">running…</div>}
        </div>
      )}
    </div>
  );
}

function prettyPrimary(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') return input.command as string;
  if ((name === 'Read' || name === 'Edit' || name === 'Write') && typeof input.file_path === 'string') return input.file_path as string;
  if (name === 'Grep' && typeof input.pattern === 'string') return String(input.pattern);
  if (name === 'Glob' && typeof input.pattern === 'string') return String(input.pattern);
  const first = Object.entries(input)[0];
  return first ? `${first[0]}=${truncate(JSON.stringify(first[1]), 80)}` : '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
