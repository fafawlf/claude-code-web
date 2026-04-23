import type { ServerPermissionRequest } from '../types';

type Props = {
  req: ServerPermissionRequest;
  onAllow: (scope: 'once' | 'session') => void;
  onDeny: () => void;
};

export function PermissionModal({ req, onAllow, onDeny }: Props) {
  const primary = primaryLine(req.toolName, req.input);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Permission required</div>
          <div className="text-base text-zinc-100 mt-1">{req.title ?? `Claude wants to use ${req.toolName}`}</div>
          {req.description && <div className="text-xs text-zinc-400 mt-1">{req.description}</div>}
        </div>
        <div className="p-5 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{req.displayName ?? req.toolName}</div>
          <pre className="text-sm bg-zinc-950 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap text-zinc-200 font-mono">{primary}</pre>
          {primary !== JSON.stringify(req.input, null, 2) && (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer select-none">full input</summary>
              <pre className="mt-2 bg-zinc-950 rounded p-2 overflow-auto">{JSON.stringify(req.input, null, 2)}</pre>
            </details>
          )}
        </div>
        <div className="px-5 py-4 bg-zinc-950/50 border-t border-zinc-800 flex gap-2 justify-end">
          <button
            onClick={onDeny}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          >
            Deny
          </button>
          <button
            onClick={() => onAllow('once')}
            className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white"
          >
            Allow once
          </button>
          <button
            onClick={() => onAllow('session')}
            className="px-3 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            Allow for session
          </button>
        </div>
      </div>
    </div>
  );
}

function primaryLine(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof input.command === 'string') return input.command as string;
  if (typeof (input as any).file_path === 'string') return String((input as any).file_path);
  return JSON.stringify(input, null, 2);
}
