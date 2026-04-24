import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getRecentCwds } from '../utils/recentCwds';

type Entry = { name: string; hasGit: boolean };
type DirsResponse = { path: string; parent: string | null; targetHasGit: boolean; entries: Entry[] };

type Props = {
  token: string;
  initial: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

type Row =
  | { kind: 'dir'; name: string; hasGit: boolean; path: string }
  | { kind: 'recent'; path: string };

// Codex-style folder picker:
//   ↑/↓         navigate the visible list
//   → / Enter   descend into the selected directory (or pick recent)
//   ← / ⌫      go up one level (Backspace when input is empty)
//   ⇧⏎         use the CURRENT path (not the selected item)
//   Esc         cancel
//   type        filter the list by substring; if input looks like a path, hit
//               Enter or Tab to navigate there directly
export function CwdPicker({ token, initial, onClose, onPick }: Props) {
  const [current, setCurrent] = useState(initial);
  const [filter, setFilter] = useState('');
  const [data, setData] = useState<DirsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [recent] = useState<string[]>(() => getRecentCwds());

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, onClose);

  // Fetch directory contents when current path changes.
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch(`/api/dirs?t=${encodeURIComponent(token)}&path=${encodeURIComponent(current)}`)
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((j: DirsResponse) => {
        if (cancelled) return;
        // Support servers that return only { dirs: string[] } (older API shape).
        const entries = j.entries ?? (Array.isArray((j as any).dirs) ? (j as any).dirs.map((n: string) => ({ name: n, hasGit: false })) : []);
        setData({ ...j, entries });
        setSel(0);
        setFilter('');
      })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [current, token]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Build the visible row list (filter + section grouping).
  const rows: Row[] = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const dirs: Row[] = (data?.entries ?? [])
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((e) => ({ kind: 'dir', name: e.name, hasGit: e.hasGit, path: joinPath(current, e.name) }));

    // Recent dirs — show only if we haven't typed a filter, and exclude ones
    // that are children of the current directory (visible already).
    const recentRows: Row[] = (!q ? recent : [])
      .filter((p) => p !== current)
      .map((p) => ({ kind: 'recent' as const, path: p }));

    return [...dirs, ...recentRows];
  }, [data, filter, current, recent]);

  // Keep selection in-bounds when the list shrinks.
  useEffect(() => { if (sel >= rows.length) setSel(Math.max(0, rows.length - 1)); }, [rows.length, sel]);

  // Scroll selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${sel}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const activate = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === 'dir') setCurrent(r.path);
    else if (r.kind === 'recent') onPick(r.path);
  };

  const goUp = () => { if (data?.parent) setCurrent(data.parent); };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onPick(current); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      // If input looks like a path and no filter-match is selected, navigate to it.
      const typed = filter.trim();
      if (looksLikePath(typed)) { setCurrent(expandPath(typed)); return; }
      activate(rows[sel]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((v) => Math.min(v + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
      return;
    }
    if (e.key === 'ArrowRight') {
      // Descend only when the caret is at the end of the input
      if (inputRef.current?.selectionStart === filter.length) {
        e.preventDefault();
        activate(rows[sel]);
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (inputRef.current?.selectionStart === 0 && !filter) {
        e.preventDefault();
        goUp();
      }
      return;
    }
    if (e.key === 'Backspace' && !filter) {
      e.preventDefault();
      goUp();
      return;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,16,15,.65)] backdrop-blur-[6px] flex items-start justify-center pt-[12vh] p-4 animate-backdrop-in" onClick={onClose}>
      <div
        ref={rootRef}
        className="w-full max-w-[640px] bg-bg-surface rounded-lg shadow-modal overflow-hidden animate-modal-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Breadcrumb path */}
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-1 text-xs text-text-muted mb-1.5">
            <span className="uppercase tracking-[.06em] font-semibold">Open project</span>
            {data?.targetHasGit && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-accent/90">
                <Icon name="git-branch" size={10} />
                git
              </span>
            )}
          </div>
          <Breadcrumbs path={current} onJump={setCurrent} />
        </div>

        {/* Filter / direct-path input */}
        <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2.5">
          <Icon name="search" size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={onKey}
            placeholder={rows.length ? 'Type to filter · ⇧⏎ to use this folder' : 'Type a path (/tmp) or folder name…'}
            className="flex-1 bg-transparent text-sm text-text-primary outline-none font-mono"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <kbd className="kbd">ESC</kbd>
        </div>

        {/* Rows */}
        <div ref={listRef} className="flex-1 overflow-y-auto max-h-[50vh]">
          {err && <div className="px-4 py-3 text-sm text-danger">{err}</div>}

          {/* Go-up row — always visible when parent exists */}
          {data?.parent && (
            <button
              onClick={goUp}
              className="w-full text-left px-4 py-2 text-xs text-text-muted hover:bg-bg-hover transition-colors duration-hover flex items-center gap-2.5 border-b border-border-subtle"
            >
              <Icon name="chev-right" size={12} className="rotate-180" />
              <span className="font-mono">..</span>
              <span className="ml-auto text-[10px] opacity-70">⌫ up</span>
            </button>
          )}

          {rows.length === 0 && !err && (
            <div className="px-4 py-6 text-xs text-text-muted text-center">
              {filter ? 'No match. ⏎ to navigate to that path anyway.' : 'No subdirectories.'}
            </div>
          )}

          {rows.map((r, idx) => {
            const selected = idx === sel;
            const isRecent = r.kind === 'recent';
            const inRecentSection = isRecent && (idx === 0 || rows[idx - 1]?.kind !== 'recent');
            return (
              <div key={r.kind === 'dir' ? `d:${r.path}` : `r:${r.path}`}>
                {inRecentSection && (
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">
                    Recent
                  </div>
                )}
                <button
                  data-row={idx}
                  onClick={() => { setSel(idx); activate(r); }}
                  onMouseEnter={() => setSel(idx)}
                  className={`w-full text-left px-4 py-2 flex items-center gap-2.5 transition-colors duration-hover ${selected ? 'bg-bg-hover' : ''}`}
                >
                  <Icon
                    name={r.kind === 'recent' ? 'clock' : 'folder'}
                    size={14}
                    className={selected ? 'text-accent' : 'text-text-muted'}
                  />
                  <span className="font-mono text-sm text-text-primary truncate">
                    {r.kind === 'dir' ? r.name : shortPath(r.path)}
                  </span>
                  {r.kind === 'dir' && r.hasGit && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-accent/80">
                      <Icon name="git-branch" size={10} />
                      git
                    </span>
                  )}
                  {r.kind === 'recent' && (
                    <span className="text-[10px] text-text-muted ml-auto">recent</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2.5 border-t border-border-subtle flex items-center gap-4 text-[10px] text-text-muted flex-wrap">
          <span><kbd className="kbd">⏎</kbd> open</span>
          <span><kbd className="kbd">⇧⏎</kbd> use this folder</span>
          <span><kbd className="kbd">⌫</kbd> up</span>
          <span className="ml-auto">
            <button
              onClick={() => onPick(current)}
              className="px-2.5 py-1 rounded-sm bg-accent hover:bg-accent-hi text-text-inverse text-[11px] font-medium transition-colors duration-hover"
            >
              Use {shortPath(current)}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Breadcrumbs({ path, onJump }: { path: string; onJump: (p: string) => void }) {
  const segs = path.split('/').filter(Boolean);
  const rooted = path.startsWith('/');
  const home = typeof window !== 'undefined' ? (window as any).__ccw_home__ as string | undefined : undefined;

  // Show the home prefix as ~ when applicable.
  let display: { label: string; path: string }[] = [];
  if (home && path.startsWith(home)) {
    display.push({ label: '~', path: home });
    const rest = path.slice(home.length).split('/').filter(Boolean);
    let acc = home;
    for (const p of rest) { acc = acc.replace(/\/$/, '') + '/' + p; display.push({ label: p, path: acc }); }
  } else {
    if (rooted) display.push({ label: '/', path: '/' });
    let acc = rooted ? '' : '';
    for (const s of segs) { acc = acc + '/' + s; display.push({ label: s, path: acc }); }
  }

  return (
    <div className="flex items-center gap-1 text-[11px] text-text-secondary font-mono overflow-x-auto">
      {display.map((d, i) => (
        <span key={d.path + i} className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onJump(d.path)}
            className="px-1.5 py-0.5 rounded hover:bg-bg-hover hover:text-text-primary transition-colors duration-hover"
          >
            {d.label}
          </button>
          {i < display.length - 1 && <Icon name="chev-right" size={10} className="text-text-muted opacity-60" />}
        </span>
      ))}
    </div>
  );
}

function joinPath(dir: string, name: string): string {
  if (dir === '/') return '/' + name;
  return dir.replace(/\/$/, '') + '/' + name;
}

function shortPath(p: string): string {
  const home = typeof window !== 'undefined' ? (window as any).__ccw_home__ as string | undefined : undefined;
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

function looksLikePath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('~') || s.startsWith('./') || s.startsWith('../');
}

function expandPath(s: string): string {
  const home = typeof window !== 'undefined' ? (window as any).__ccw_home__ as string | undefined : undefined;
  if (s === '~') return home ?? '/';
  if (s.startsWith('~/') && home) return home.replace(/\/$/, '') + s.slice(1);
  return s;
}
