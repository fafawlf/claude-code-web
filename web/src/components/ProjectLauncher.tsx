import { useEffect, useMemo, useState } from 'react';
import { normalizeProjectPath, projectName, type ProjectEntry } from '../projectHistory';
import { Icon } from './Icon';

type DirsResponse = { path: string; parent: string | null; dirs: string[] };

type Props = {
  token: string;
  current: string;
  recents: ProjectEntry[];
  pinned: string[];
  busy?: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
  onTogglePin: (path: string) => void;
};

export function ProjectLauncher({ token, current, recents, pinned, busy, onClose, onPick, onTogglePin }: Props) {
  const [input, setInput] = useState(current);
  const [browsePath, setBrowsePath] = useState(current);
  const [selectedPath, setSelectedPath] = useState(current);
  const [data, setData] = useState<DirsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (newFolderOpen) {
          e.preventDefault();
          setNewFolderOpen(false);
          setNewFolderName('');
          return;
        }
        onClose();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) choose(selectedPath || browsePath);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [browsePath, newFolderOpen, onClose, selectedPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/dirs?t=${encodeURIComponent(token)}&path=${encodeURIComponent(browsePath)}`)
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((j: DirsResponse) => {
        if (!cancelled) {
          setData(j);
          setInput(j.path);
          setSelectedPath(j.path);
        }
      })
      .catch((e) => { if (!cancelled) { setData(null); setErr(String(e.message || e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [browsePath, token]);

  const recentPaths = useMemo(
    () => recents.map((p) => p.path).filter((p) => p !== current && !pinned.includes(p)),
    [current, pinned, recents]
  );

  const choose = (path: string) => {
    onPick(normalizeProjectPath(path));
    onClose();
  };

  const openPath = (path: string) => {
    const normalized = normalizeProjectPath(path);
    setBrowsePath(normalized);
    setSelectedPath(normalized);
    setInput(normalized);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setErr('Folder name required');
      return;
    }
    setCreatingFolder(true);
    setErr(null);
    try {
      const r = await fetch(`/api/dirs?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPath: data?.path ?? browsePath, name }),
      });
      if (!r.ok) throw new Error(await readError(r));
      const j = await r.json() as { path: string };
      setNewFolderOpen(false);
      setNewFolderName('');
      openPath(j.path);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div className="project-launcher fixed left-1/2 top-[7vh] z-50 w-[760px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface shadow-modal" role="dialog" aria-modal="true" aria-label="Project Finder">
      <div className="h-11 border-b border-border-subtle bg-bg-raised/70 px-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="w-3 h-3 rounded-full bg-danger/80" />
          <span className="w-3 h-3 rounded-full bg-warning/80" />
          <span className="w-3 h-3 rounded-full bg-success/80" />
        </div>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-sm font-medium text-text-primary">Choose project folder</div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-sm grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover"
          aria-label="Close Finder"
          title="Close"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="project-launcher-body flex min-h-[460px] max-h-[72vh]">
        <aside className="project-launcher-sidebar w-48 shrink-0 border-r border-border-subtle bg-bg-raised/45 p-2 overflow-y-auto">
          <FinderSection title="Favorites">
            <FinderShortcut label="Current project" path={current} active={browsePath === current} onPick={openPath} />
            {pinned.map((path) => (
              <FinderShortcut key={path} label={projectName(path)} path={path} active={browsePath === path} onPick={openPath} pinned onTogglePin={onTogglePin} />
            ))}
          </FinderSection>
          {recentPaths.length > 0 && (
            <FinderSection title="Recent">
              {recentPaths.map((path) => (
                <FinderShortcut key={path} label={projectName(path)} path={path} active={browsePath === path} onPick={openPath} onTogglePin={onTogglePin} />
              ))}
            </FinderSection>
          )}
        </aside>

        <main className="project-launcher-main min-w-0 flex-1 flex flex-col">
          <div className="project-launcher-toolbar px-4 py-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <button
                onClick={() => data?.parent && openPath(data.parent)}
                disabled={!data?.parent}
                className="w-8 h-8 rounded-sm grid place-items-center text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-35 disabled:hover:bg-transparent transition-colors duration-hover"
                aria-label="Go to parent folder"
                title="Parent folder"
              >
                <Icon name="chev-right" size={15} className="rotate-180" />
              </button>
              <form
                className="min-w-0 flex-1"
                onSubmit={(e) => { e.preventDefault(); openPath(input); }}
              >
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full bg-bg-base border border-border-subtle rounded-sm px-3 py-1.5 text-sm font-mono text-text-primary outline-none focus:border-accent"
                  placeholder="/path/to/project"
                />
              </form>
              <button
                type="button"
                onClick={() => setNewFolderOpen(true)}
                className="h-8 shrink-0 rounded-sm border border-border-subtle bg-bg-base px-2.5 text-xs text-text-secondary hover:border-border hover:bg-bg-hover hover:text-text-primary transition-colors duration-hover inline-flex items-center gap-1.5"
                aria-label="New Folder"
                title="New Folder"
              >
                <Icon name="folder-plus" size={14} />
                New Folder
              </button>
            </div>
            <Breadcrumb path={browsePath} onPick={openPath} />
            {newFolderOpen && (
              <form
                className="mt-3 flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base p-2"
                onSubmit={(e) => { e.preventDefault(); void createFolder(); }}
              >
                <Icon name="folder-plus" size={15} className="shrink-0 text-accent" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
                  placeholder="Folder name"
                  disabled={creatingFolder}
                />
                <button
                  type="submit"
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="h-7 rounded-sm bg-accent px-2.5 text-xs font-medium text-text-inverse hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-45 transition-colors duration-hover"
                >
                  {creatingFolder ? 'Creating' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}
                  className="grid h-7 w-7 place-items-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors duration-hover"
                  aria-label="Cancel new folder"
                  title="Cancel"
                >
                  <Icon name="x" size={13} />
                </button>
              </form>
            )}
            <div className="mt-2 text-[11px] text-text-muted">Browsing folders on the machine running claudecode-web.</div>
            {busy && <div className="mt-2 text-[11px] text-warning">Current chat will keep working in Activity.</div>}
          </div>

          <div className="project-launcher-list flex-1 overflow-y-auto bg-bg-base/40">
            {loading && <LoadingRows />}
            {err && <div className="m-4 rounded-md border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{err}</div>}
            {!loading && !err && data && (
              <div className="py-2">
                <FolderRow
                  label="Choose this folder"
                  path={data.path}
                  selected={selectedPath === data.path}
                  emphasized
                  onSelect={setSelectedPath}
                  onOpen={choose}
                />
                {data.parent && (
                  <FolderRow
                    label=".."
                    path={data.parent}
                    selected={selectedPath === data.parent}
                    muted
                    onSelect={setSelectedPath}
                    onOpen={openPath}
                  />
                )}
                {data.dirs.length === 0 && <div className="px-5 py-8 text-center text-xs text-text-muted">No subfolders.</div>}
                {data.dirs.map((d) => {
                  const path = data.path.replace(/\/$/, '') + '/' + d;
                  return (
                    <FolderRow
                      key={d}
                      label={d}
                      path={path}
                      selected={selectedPath === path}
                      onSelect={setSelectedPath}
                      onOpen={openPath}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="project-launcher-footer h-14 border-t border-border-subtle bg-bg-raised/45 px-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[.06em] text-text-muted font-semibold">Selected</div>
              <div className="font-mono text-[11px] text-text-secondary truncate" title={selectedPath}>{selectedPath}</div>
            </div>
            <button onClick={onClose} className="px-3 py-1.5 rounded-sm bg-bg-hover hover:bg-bg-surface text-text-secondary hover:text-text-primary text-sm transition-colors duration-hover">
              Cancel
            </button>
            <button onClick={() => choose(selectedPath || browsePath)} className="px-3.5 py-1.5 rounded-sm bg-accent hover:bg-accent-hi text-text-inverse text-sm font-medium transition-colors duration-hover">
              Open folder
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function FinderSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function FinderShortcut({ label, path, active, pinned, onPick, onTogglePin }: { label: string; path: string; active: boolean; pinned?: boolean; onPick: (path: string) => void; onTogglePin?: (path: string) => void }) {
  return (
    <div className={`group flex items-center gap-1 rounded-sm ${active ? 'bg-bg-hover' : 'hover:bg-bg-hover'} transition-colors duration-hover`}>
      <button onClick={() => onPick(path)} className="min-w-0 flex-1 px-2 py-1.5 flex items-center gap-2 text-left" title={path}>
        <Icon name="folder" size={13} className={active ? 'text-accent' : 'text-text-muted'} />
        <span className="truncate text-sm text-text-secondary group-hover:text-text-primary">{label}</span>
      </button>
      {onTogglePin && (
        <button
          onClick={() => onTogglePin(path)}
          className={`mr-1 px-1.5 py-0.5 rounded text-[10px] transition-colors duration-hover ${pinned ? 'text-warning' : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary'}`}
          title={pinned ? 'Unpin project' : 'Pin project'}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </button>
      )}
    </div>
  );
}

function Breadcrumb({ path, onPick }: { path: string; onPick: (path: string) => void }) {
  const parts = path.split('/').filter(Boolean);
  const crumbs = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    crumbs.push({ label: part, path: acc });
  }
  return (
    <div className="mt-2 flex items-center gap-1 overflow-x-auto text-xs text-text-muted">
      {crumbs.map((c, i) => (
        <span key={c.path} className="inline-flex items-center gap-1 shrink-0">
          {i > 0 && <span>/</span>}
          <button onClick={() => onPick(c.path)} className="px-1.5 py-0.5 rounded hover:bg-bg-hover hover:text-text-primary transition-colors duration-hover">{c.label}</button>
        </span>
      ))}
    </div>
  );
}

function FolderRow({ label, path, selected, muted, emphasized, onSelect, onOpen }: { label: string; path: string; selected: boolean; muted?: boolean; emphasized?: boolean; onSelect: (path: string) => void; onOpen: (path: string) => void }) {
  return (
    <button
      onClick={() => onSelect(path)}
      onDoubleClick={() => onOpen(path)}
      className={`w-full grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 text-left transition-colors duration-hover ${selected ? 'bg-bg-hover text-text-primary' : muted ? 'text-text-muted hover:bg-bg-hover' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
      title={path}
    >
      <Icon name={muted ? 'chev-right' : 'folder'} size={14} className={muted ? 'rotate-180 text-text-muted' : emphasized ? 'text-accent' : 'text-text-muted'} />
      <span className={`truncate text-sm ${emphasized ? 'font-medium' : ''}`}>{label}</span>
      <span className="folder-row-path truncate font-mono text-[11px] text-text-muted">{path}</span>
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="p-4 space-y-2">
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-8 rounded bg-bg-raised animate-pulse" />)}
    </div>
  );
}

async function readError(r: Response): Promise<string> {
  try {
    const parsed = await r.json() as { error?: string };
    return parsed.error ?? r.statusText;
  } catch {
    return r.statusText || 'Request failed';
  }
}
