import type { ChatItem } from '../types';

type Props = {
  item: Extract<ChatItem, { kind: 'tool_use' }>;
  pendingReqId?: string; // present while awaiting user decision
  onAccept: (reqId: string) => void;
  onReject: (reqId: string) => void;
};

type Hunk = { oldText: string; newText: string; replaceAll?: boolean };

function extractHunks(name: string, input: Record<string, unknown>): { filePath: string; hunks: Hunk[] } {
  const filePath = String((input as any).file_path ?? (input as any).path ?? '');
  if (name === 'Write') {
    return { filePath, hunks: [{ oldText: '', newText: String((input as any).content ?? '') }] };
  }
  if (name === 'Edit') {
    return {
      filePath,
      hunks: [{
        oldText: String((input as any).old_string ?? ''),
        newText: String((input as any).new_string ?? ''),
        replaceAll: !!(input as any).replace_all,
      }],
    };
  }
  if (name === 'MultiEdit') {
    const raw = Array.isArray((input as any).edits) ? (input as any).edits : [];
    return {
      filePath,
      hunks: raw.map((e: any) => ({
        oldText: String(e.old_string ?? ''),
        newText: String(e.new_string ?? ''),
        replaceAll: !!e.replace_all,
      })),
    };
  }
  return { filePath, hunks: [{ oldText: '', newText: JSON.stringify(input, null, 2) }] };
}

export function DiffBlock({ item, pendingReqId, onAccept, onReject }: Props) {
  const { filePath, hunks } = extractHunks(item.name, item.input);
  const hasResult = !!item.result;
  const isError = item.result?.isError;

  const borderClass = pendingReqId
    ? 'border-amber-900/60 bg-amber-500/5'
    : isError
      ? 'border-red-900/70 bg-red-950/20'
      : hasResult
        ? 'border-emerald-900/40 bg-emerald-500/5'
        : 'border-zinc-800 bg-zinc-900/40';

  return (
    <div className={`rounded-lg border ${borderClass} overflow-hidden`}>
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800/70">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${isError ? 'text-red-400' : pendingReqId ? 'text-amber-400' : hasResult ? 'text-emerald-400' : 'text-zinc-400'}`}>
          {item.name}
        </span>
        <span className="font-mono text-xs text-zinc-300 truncate flex-1" title={filePath}>{filePath}</span>
        {pendingReqId && (
          <div className="flex gap-1">
            <button
              onClick={() => onReject(pendingReqId)}
              className="px-2 py-0.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >Reject</button>
            <button
              onClick={() => onAccept(pendingReqId)}
              className="px-2 py-0.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >Accept</button>
          </div>
        )}
      </div>
      <div className="p-2 space-y-2">
        {hunks.map((h, i) => <Hunk key={i} hunk={h} />)}
      </div>
      {hasResult && (
        <div className={`px-3 py-2 text-xs border-t border-zinc-800/70 ${isError ? 'bg-red-950/40 text-red-200' : 'bg-zinc-950/40 text-zinc-400'}`}>
          {isError ? '✗ ' : '✓ '}{(item.result!.content || '').slice(0, 200)}{(item.result!.content?.length ?? 0) > 200 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

function Hunk({ hunk }: { hunk: Hunk }) {
  const oldLines = hunk.oldText.split('\n');
  const newLines = hunk.newText.split('\n');
  return (
    <div className="rounded bg-zinc-950/60 overflow-hidden text-xs font-mono">
      {hunk.oldText && (
        <div className="bg-red-950/30 border-l-2 border-red-900/60">
          {oldLines.map((line, i) => (
            <div key={`o${i}`} className="px-2 py-0.5 text-red-300 whitespace-pre-wrap"><span className="text-red-500/70 select-none mr-2">-</span>{line}</div>
          ))}
        </div>
      )}
      {hunk.newText && (
        <div className="bg-emerald-950/30 border-l-2 border-emerald-900/60">
          {newLines.map((line, i) => (
            <div key={`n${i}`} className="px-2 py-0.5 text-emerald-300 whitespace-pre-wrap"><span className="text-emerald-500/70 select-none mr-2">+</span>{line}</div>
          ))}
        </div>
      )}
      {hunk.replaceAll && <div className="px-2 py-0.5 text-[10px] text-zinc-500 bg-zinc-900/50">replace_all</div>}
    </div>
  );
}
