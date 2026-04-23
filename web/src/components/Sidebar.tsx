import { useMemo, useState } from 'react';
import type { StoredSession } from '../types';

type Props = {
  cwd: string;
  sessions: StoredSession[];
  activeId: string | null;
  onNew: () => void;
  onResume: (claudeId: string) => void;
  onRefresh: () => void;
  onRename: (claudeId: string, newTitle: string) => void;
  connected: boolean;
};

export function Sidebar({ cwd, sessions, onNew, onResume, onRefresh, onRename, connected }: Props) {
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...sessions].sort((a, b) => b.lastModified - a.lastModified);
    if (!q) return list;
    return list.filter((s) => {
      const text = [s.customTitle, s.summary, s.firstPrompt].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [sessions, search]);

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
        <span className="text-xs text-zinc-400 font-medium">claudecode-web</span>
      </div>

      <div className="p-3 space-y-2">
        <button
          onClick={onNew}
          className="w-full text-left px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm text-white font-medium"
        >
          + New chat
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search history…"
          className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-xs text-zinc-200 placeholder:text-zinc-600"
        />
      </div>

      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">History</span>
        <button onClick={onRefresh} className="text-[10px] text-zinc-500 hover:text-zinc-300" title="refresh">↻</button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {sorted.length === 0 && <div className="px-2 text-xs text-zinc-500">{search ? 'No matches.' : 'No prior sessions.'}</div>}
        {sorted.map((s) => (
          <div key={s.sessionId} className="group relative rounded hover:bg-zinc-900">
            {renamingId === s.sessionId ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (draft.trim()) onRename(s.sessionId, draft.trim()); setRenamingId(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                  if (e.key === 'Escape') { setRenamingId(null); }
                }}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100"
              />
            ) : (
              <>
                <button
                  onClick={() => onResume(s.sessionId)}
                  className="w-full text-left px-3 py-2 rounded"
                  title={s.sessionId}
                >
                  <div className="text-sm text-zinc-200 line-clamp-2 pr-8">
                    {s.customTitle ?? s.summary ?? s.firstPrompt ?? '(untitled)'}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2">
                    <span>{new Date(s.lastModified).toLocaleString()}</span>
                    {s.gitBranch && <span className="truncate">⎇ {s.gitBranch}</span>}
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingId(s.sessionId); setDraft(s.customTitle ?? s.summary ?? ''); }}
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded"
                  title="rename"
                >✎</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono break-all" title={cwd}>
        <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">project</div>
        {cwd}
      </div>
    </aside>
  );
}
