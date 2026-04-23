import { useMemo } from 'react';

export type StoredSession = {
  sessionId: string;
  summary?: string;
  customTitle?: string;
  firstPrompt?: string;
  lastModified: number;
  gitBranch?: string;
};

type Props = {
  cwd: string;
  sessions: StoredSession[];
  activeId: string | null;
  onNew: () => void;
  onResume: (claudeId: string) => void;
  onRefresh: () => void;
  connected: boolean;
};

export function Sidebar({ cwd, sessions, onNew, onResume, onRefresh, connected }: Props) {
  const sorted = useMemo(() => [...sessions].sort((a, b) => b.lastModified - a.lastModified), [sessions]);
  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
        <span className="text-xs text-zinc-400 font-medium">claudecode-web</span>
      </div>
      <div className="p-3 space-y-2">
        <button
          onClick={onNew}
          className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm font-medium"
        >
          + New chat
        </button>
        <button
          onClick={onRefresh}
          className="w-full text-left px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
        >
          ↻ Refresh history
        </button>
      </div>
      <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-zinc-500">Project</div>
      <div className="px-3 pb-3 text-xs text-zinc-400 font-mono break-all" title={cwd}>{cwd}</div>
      <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-zinc-500">History</div>
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {sorted.length === 0 && <div className="px-2 text-xs text-zinc-500">No prior sessions in this project.</div>}
        {sorted.map((s) => (
          <button
            key={s.sessionId}
            onClick={() => onResume(s.sessionId)}
            className="w-full text-left px-3 py-2 rounded hover:bg-zinc-900 group"
            title={s.sessionId}
          >
            <div className="text-sm text-zinc-200 line-clamp-2">
              {s.customTitle ?? s.summary ?? s.firstPrompt ?? '(untitled)'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2">
              <span>{new Date(s.lastModified).toLocaleString()}</span>
              {s.gitBranch && <span className="truncate">⎇ {s.gitBranch}</span>}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
