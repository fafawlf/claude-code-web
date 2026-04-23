import type { ChatItem } from '../types';
import { Icon } from './Icon';

type Props = {
  item: Extract<ChatItem, { kind: 'tool_use' }>;
  pendingReqId?: string;
  onAccept: (reqId: string) => void;
  onReject: (reqId: string) => void;
};

type Hunk = { oldText: string; newText: string; replaceAll?: boolean };

function extractHunks(name: string, input: Record<string, unknown>): { filePath: string; hunks: Hunk[] } {
  const filePath = String((input as any).file_path ?? (input as any).path ?? '');
  if (name === 'Write') return { filePath, hunks: [{ oldText: '', newText: String((input as any).content ?? '') }] };
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

function countChanges(hunks: Hunk[]): { plus: number; minus: number } {
  let plus = 0, minus = 0;
  for (const h of hunks) {
    if (h.oldText) minus += h.oldText.split('\n').length;
    if (h.newText) plus += h.newText.split('\n').length;
  }
  return { plus, minus };
}

export function DiffBlock({ item, pendingReqId, onAccept, onReject }: Props) {
  const { filePath, hunks } = extractHunks(item.name, item.input);
  const { plus, minus } = countChanges(hunks);
  const hasResult = !!item.result;
  const isError = item.result?.isError;

  let borderCls = 'border-border-subtle';
  let tnameCls = 'text-accent';
  if (pendingReqId) { borderCls = 'border-warning/60'; tnameCls = 'text-warning'; }
  else if (hasResult && !isError) { borderCls = 'border-success/50'; tnameCls = 'text-success'; }
  else if (isError) { borderCls = 'border-danger/50'; tnameCls = 'text-danger'; }

  return (
    <div className={`rounded-md border bg-bg-raised overflow-hidden transition-[border-color] duration-mode ease-soft ${borderCls} ${pendingReqId ? 'shadow-[0_0_0_3px_rgba(212,169,94,.08)]' : ''}`}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-subtle">
        <Icon name="pencil" size={13} className={tnameCls} />
        <span className={`text-[11px] uppercase tracking-wider font-semibold ${tnameCls}`}>{item.name}</span>
        <span className="font-mono text-xs text-text-primary flex-1 truncate" title={filePath}>{filePath}</span>
        <span className="font-mono text-[11px] text-text-muted">
          <span className="text-success">+{plus}</span> <span className="text-danger">−{minus}</span>
        </span>
      </div>
      <div className="font-mono text-xs leading-[1.55]">
        {hunks.map((h, i) => <HunkView key={i} hunk={h} />)}
      </div>
      {pendingReqId ? (
        <div className="px-3.5 py-2.5 border-t border-border-subtle flex justify-end gap-2">
          <button
            onClick={() => onReject(pendingReqId)}
            className="px-3 py-1.5 text-xs font-medium rounded-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors duration-hover"
          >Reject</button>
          <button
            onClick={() => onAccept(pendingReqId)}
            className="px-3 py-1.5 text-xs font-medium rounded-sm bg-success text-text-inverse hover:brightness-110 transition-[filter] duration-hover"
          >Accept</button>
        </div>
      ) : hasResult && !isError ? (
        <div className="px-3.5 py-2 text-xs text-text-secondary flex items-center gap-2 border-t border-border-subtle">
          <Icon name="check" size={12} className="text-success" />
          Accepted · <span className="text-success">+{plus}</span> <span className="text-danger">−{minus}</span>
        </div>
      ) : isError ? (
        <div className="px-3.5 py-2 text-xs text-danger flex items-center gap-2 border-t border-border-subtle">
          <Icon name="x" size={12} />
          Failed{item.result?.content ? ` — ${item.result.content.slice(0, 120)}` : ''}
        </div>
      ) : null}
    </div>
  );
}

function HunkView({ hunk }: { hunk: Hunk }) {
  const oldLines = hunk.oldText ? hunk.oldText.split('\n') : [];
  const newLines = hunk.newText ? hunk.newText.split('\n') : [];
  return (
    <div>
      {oldLines.map((line, i) => (
        <div key={`o${i}`} className="flex bg-danger/[.08]">
          <span className="w-12 px-2 text-right text-text-muted opacity-60 shrink-0 select-none">{i + 1}</span>
          <span className="w-4 text-center text-danger shrink-0">−</span>
          <span className="pr-3.5 whitespace-pre-wrap break-all">{line || ' '}</span>
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`n${i}`} className="flex bg-success/[.08]">
          <span className="w-12 px-2 text-right text-text-muted opacity-60 shrink-0 select-none">{i + 1}</span>
          <span className="w-4 text-center text-success shrink-0">+</span>
          <span className="pr-3.5 whitespace-pre-wrap break-all">{line || ' '}</span>
        </div>
      ))}
      {hunk.replaceAll && <div className="px-3 py-0.5 text-[10px] text-text-muted bg-bg-base/50">replace_all</div>}
    </div>
  );
}
