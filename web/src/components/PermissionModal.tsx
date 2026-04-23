import { useRef } from 'react';
import type { ServerPermissionRequest } from '../types';
import { Icon, type IconName } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';

type Props = {
  req: ServerPermissionRequest;
  onAllow: (scope: 'once' | 'session') => void;
  onDeny: () => void;
};

const TOOL_ICON: Record<string, IconName> = {
  Bash: 'terminal',
  Read: 'file',
  WebFetch: 'code',
  WebSearch: 'search',
};

export function PermissionModal({ req, onAllow, onDeny }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onDeny);

  const icon = TOOL_ICON[req.toolName] ?? 'shield';
  const primary = primaryLine(req.toolName, req.input);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,16,15,.65)] backdrop-blur-[6px] flex items-center justify-center p-4 animate-backdrop-in">
      <div ref={ref} className="w-full max-w-[560px] bg-bg-surface rounded-lg shadow-modal overflow-hidden animate-modal-in" role="dialog" aria-modal="true">
        <div className="px-6 pt-5 pb-3.5 border-b border-border-subtle">
          <div className="w-9 h-9 rounded-full bg-bg-accent-soft text-accent grid place-items-center mb-3">
            <Icon name={icon} size={18} />
          </div>
          <div className="text-lg font-medium text-text-primary">
            {req.title ?? `Claude wants to use ${req.toolName}`}
          </div>
          {req.description && <div className="text-xs text-text-muted mt-1">{req.description}</div>}
        </div>
        <div className="px-6 py-4.5">
          <pre className="font-mono text-xs bg-bg-base border border-border-subtle rounded-sm p-3 text-text-primary whitespace-pre-wrap max-h-60 overflow-y-auto">{primary}</pre>
          {primary !== JSON.stringify(req.input, null, 2) && (
            <details className="text-xs text-text-muted mt-2">
              <summary className="cursor-pointer select-none">full input</summary>
              <pre className="mt-2 bg-bg-base rounded-sm p-2 overflow-auto">{JSON.stringify(req.input, null, 2)}</pre>
            </details>
          )}
        </div>
        <div className="px-6 py-4 bg-bg-base/50 border-t border-border-subtle flex gap-2 justify-end">
          <button onClick={onDeny} className="px-3.5 py-2 text-sm font-medium rounded-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-hover">Deny</button>
          <button onClick={() => onAllow('once')} className="px-3.5 py-2 text-sm font-medium rounded-sm text-text-primary border border-border hover:bg-bg-hover hover:border-accent hover:text-accent-hi transition-all duration-hover">Allow once</button>
          <button onClick={() => onAllow('session')} className="px-3.5 py-2 text-sm font-medium rounded-sm bg-accent text-text-inverse hover:bg-accent-hi transition-all duration-hover">Allow for session</button>
        </div>
      </div>
    </div>
  );
}

function primaryLine(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof (input as any).command === 'string') return String((input as any).command);
  if (typeof (input as any).file_path === 'string') return String((input as any).file_path);
  if (typeof (input as any).url === 'string') return String((input as any).url);
  return JSON.stringify(input, null, 2);
}
