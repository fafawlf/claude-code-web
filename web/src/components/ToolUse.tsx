import { useState } from 'react';
import type { ChatItem } from '../types';
import { Icon, type IconName } from './Icon';
import { CodeBlock } from './CodeBlock';

type Props = { item: Extract<ChatItem, { kind: 'tool_use' }>; defaultOpen?: boolean };

const TOOL_ICON: Record<string, IconName> = {
  Bash: 'terminal',
  Read: 'file',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'code',
  WebSearch: 'search',
  TodoWrite: 'list',
  Task: 'sparkles',
};

function primaryArg(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') return input.command as string;
  if ((name === 'Read' || name === 'Edit' || name === 'Write') && typeof input.file_path === 'string') return input.file_path as string;
  if (name === 'Grep' && typeof input.pattern === 'string') return String(input.pattern);
  if (name === 'Glob' && typeof input.pattern === 'string') return String(input.pattern);
  const first = Object.entries(input)[0];
  return first ? `${first[0]}=${JSON.stringify(first[1]).slice(0, 80)}` : '';
}

export function ToolUse({ item, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const hasResult = !!item.result;
  const isError = item.result?.isError;
  const icon = TOOL_ICON[item.name] ?? 'code';
  const primary = primaryArg(item.name, item.input);

  return (
    <div className={`rounded-md border bg-bg-raised overflow-hidden transition-[border-color,transform] duration-hover ease-out ${isError ? 'border-danger/45' : open ? 'bg-bg-surface border-border' : 'border-border-subtle hover:border-border hover:-translate-y-px'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <Icon name={icon} size={14} className="text-accent opacity-80" />
        <span className="text-[11px] uppercase tracking-wider font-semibold text-accent/90">{item.name}</span>
        <span className="font-mono text-xs text-text-secondary truncate flex-1">{primary}</span>
        {hasResult && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${isError ? 'text-danger bg-danger/10' : 'text-success bg-success/10'}`}>
            {isError ? 'failed' : 'done'}
          </span>
        )}
        <Icon name="chev-down" size={12} className={`text-text-muted transition-transform duration-hover ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`transition-[max-height] duration-enter ease-soft overflow-hidden ${open ? 'max-h-[900px]' : 'max-h-0'}`}>
        <div className="border-t border-border-subtle">
          <div className="px-3.5 py-2.5">
            <CodeBlock
              code={JSON.stringify(item.input, null, 2)}
              language="json"
              defaultWrap
              limited
              className="my-0"
            />
          </div>
          {hasResult && (
            <div className={`px-3.5 py-2.5 border-t border-border-subtle ${isError ? 'bg-danger/10' : 'bg-bg-base'}`}>
              <CodeBlock
                code={item.result!.content}
                language={guessResultLanguage(item.result!.content)}
                defaultWrap
                limited
                className="my-0"
              />
            </div>
          )}
          {!hasResult && <div className="text-xs text-text-muted px-3.5 py-2.5">running…</div>}
        </div>
      </div>
    </div>
  );
}

function guessResultLanguage(content: string): string {
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return 'json';
  return 'text';
}
