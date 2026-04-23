import { useMemo, useState } from 'react';
import type { StoredSession } from '../types';
import { Icon } from './Icon';
import { groupSessions } from '../utils/groupSessions';

type Props = {
  cwd: string;
  sessions: StoredSession[];
  activeId: string | null;
  onNew: () => void;
  onResume: (claudeId: string, title?: string) => void;
  onRefresh: () => void;
  onRename: (claudeId: string, newTitle: string) => void;
  connected: boolean;
  onOpenCommandPalette: () => void;
};

export function Sidebar({ cwd, sessions, activeId, onNew, onResume, onRefresh, onRename, connected, onOpenCommandPalette }: Props) {
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...sessions].sort((a, b) => b.lastModified - a.lastModified);
    const filtered = q
      ? list.filter((s) => [s.customTitle, s.summary, s.firstPrompt].filter(Boolean).join(' ').toLowerCase().includes(q))
      : list;
    return groupSessions(filtered);
  }, [sessions, search]);

  return (
    <aside className="w-72 shrink-0 bg-bg-raised border-r border-border-subtle flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
        <div
          className="w-[26px] h-[26px] rounded-md grid place-items-center text-text-inverse text-[13px] font-semibold"
          style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-lo) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,230,200,.2)',
          }}
        >
          cc
        </div>
        <div className="text-sm font-medium text-text-primary">claude-code-web</div>
        <button
          onClick={onOpenCommandPalette}
          className="ml-auto kbd hover:text-text-primary transition-colors duration-hover"
          title="Open command palette"
        >
          ⌘K
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-accent-hi bg-bg-accent-soft border border-accent/15 hover:bg-accent/[.18] hover:border-accent/30 transition-all duration-hover ease-out"
        >
          <Icon name="plus" size={16} />
          New chat
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-bg-surface border border-transparent focus-within:border-border transition-colors duration-hover">
          <Icon name="search" size={14} className="text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history…"
            className="flex-1 text-sm outline-none bg-transparent text-text-primary placeholder:text-text-muted"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-2">
        <span className="text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">History</span>
        <button onClick={onRefresh} className="text-[10px] text-text-muted hover:text-text-secondary transition-colors duration-hover" title="refresh">↻</button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {groups.length === 0 && <div className="px-3.5 py-3 text-xs text-text-muted">{search ? 'No matches.' : 'No prior sessions.'}</div>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">
              {g.label}
            </div>
            {g.items.map((s) => {
              const active = s.sessionId === activeId;
              const title = s.customTitle ?? s.summary ?? s.firstPrompt ?? '(untitled)';
              return (
                <div key={s.sessionId} className="group relative mx-1 my-px rounded-sm hover:bg-bg-hover transition-colors duration-hover">
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
                      className="w-full px-3 py-2 bg-bg-surface border border-border rounded text-sm text-text-primary outline-none"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => onResume(s.sessionId, title)}
                        className={`w-full text-left px-3 py-2.5 rounded-sm ${active ? 'bg-bg-hover shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
                        title={s.sessionId}
                      >
                        <div className="text-sm text-text-primary line-clamp-2 pr-10">{title}</div>
                        <div className="text-[11px] text-text-muted mt-0.5 flex gap-2 items-center">
                          <Icon name="clock" size={10} />
                          <span>{formatTime(s.lastModified)}</span>
                          {s.gitBranch && <>
                            <Icon name="git-branch" size={10} />
                            <span className="truncate">{s.gitBranch}</span>
                          </>}
                        </div>
                      </button>
                      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-hover">
                        <button
                          onClick={() => { setRenamingId(s.sessionId); setDraft(s.customTitle ?? s.summary ?? ''); }}
                          className="w-[22px] h-[22px] rounded grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-base transition-all duration-hover"
                          title="rename"
                        ><Icon name="pencil" size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-border-subtle px-4 py-3">
        <div className="text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted mb-1">Project</div>
        <div className="font-mono text-[11px] text-text-secondary break-all" title={cwd}>{cwd}</div>
      </div>
    </aside>
  );
}

function formatTime(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const yd = new Date(now);
  yd.setDate(now.getDate() - 1);
  if (d.toDateString() === yd.toDateString()) {
    return 'Yesterday ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
