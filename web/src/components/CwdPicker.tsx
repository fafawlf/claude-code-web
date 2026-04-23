import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';

type DirsResponse = { path: string; parent: string | null; dirs: string[] };

type Props = {
  token: string;
  initial: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

export function CwdPicker({ token, initial, onClose, onPick }: Props) {
  const [current, setCurrent] = useState(initial);
  const [data, setData] = useState<DirsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);

  useEffect(() => {
    setErr(null);
    fetch(`/api/dirs?t=${encodeURIComponent(token)}&path=${encodeURIComponent(current)}`)
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((j: DirsResponse) => setData(j))
      .catch((e) => setErr(String(e.message || e)));
  }, [current, token]);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,16,15,.65)] backdrop-blur-[6px] flex items-center justify-center p-4 animate-backdrop-in" onClick={onClose}>
      <div ref={ref} className="w-full max-w-[520px] bg-bg-surface rounded-lg shadow-modal overflow-hidden animate-modal-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="p-4 border-b border-border-subtle">
          <div className="text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">Open project</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onPick(current); }}
              className="flex-1 bg-bg-base border border-border-subtle rounded-sm px-3 py-1.5 text-sm font-mono text-text-primary outline-none focus:border-accent"
              placeholder="/path/to/project"
            />
            <button onClick={() => onPick(current)} className="px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hi text-text-inverse text-sm font-medium transition-colors duration-hover">Use this folder</button>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto text-sm">
          {err && <div className="p-4 text-danger text-sm">{err}</div>}
          {data && data.parent && (
            <button
              onClick={() => setCurrent(data.parent!)}
              className="w-full text-left px-4 py-2 hover:bg-bg-hover border-b border-border-subtle text-text-secondary font-mono transition-colors duration-hover flex items-center gap-2"
            >
              <Icon name="chev-right" size={12} className="rotate-180" />
              <span>..</span>
            </button>
          )}
          {data?.dirs.length === 0 && <div className="p-4 text-text-muted text-xs">No subdirectories.</div>}
          {data?.dirs.map((d) => (
            <button
              key={d}
              onClick={() => setCurrent(data.path.replace(/\/$/, '') + '/' + d)}
              onDoubleClick={() => onPick(data.path.replace(/\/$/, '') + '/' + d)}
              className="w-full text-left px-4 py-2 hover:bg-bg-hover font-mono text-text-primary transition-colors duration-hover flex items-center gap-2.5"
              title="double-click to open"
            >
              <Icon name="folder" size={14} className="text-text-muted" />
              <span>{d}</span>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-border-subtle flex justify-end gap-2 text-sm">
          <button onClick={onClose} className="px-3 py-1.5 rounded-sm bg-bg-hover hover:bg-bg-raised text-text-secondary hover:text-text-primary transition-colors duration-hover">Cancel</button>
        </div>
      </div>
    </div>
  );
}
