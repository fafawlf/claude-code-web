import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { appUrl } from '../appUrl';

type Props = {
  token: string;
  cwd: string;
  query: string;
  onPick: (path: string) => void;
  onClose: () => void;
};

export function MentionPopup({ token, cwd, query, onPick, onClose }: Props) {
  const [results, setResults] = useState<string[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const url = appUrl(`/api/files?t=${encodeURIComponent(token)}&cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}&limit=30`);
    fetch(url)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setResults(j.results ?? []); setI(0); } })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [query, cwd, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(v + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (results[i]) onPick(results[i]); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [results, i, onPick, onClose]);

  if (results.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-w-md bg-bg-surface border border-border rounded-md shadow-pop overflow-hidden animate-modal-in origin-bottom-left">
      <div className="px-3.5 py-1.5 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted border-b border-border-subtle">Attach file</div>
      <div className="max-h-56 overflow-y-auto">
        {results.map((r, idx) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            onMouseEnter={() => setI(idx)}
            className={`w-full text-left px-3.5 py-1.5 flex items-center gap-2.5 transition-colors duration-hover ${idx === i ? 'bg-bg-hover' : ''}`}
          >
            <Icon name="file" size={13} className="text-text-muted" />
            <span className="font-mono text-xs text-text-primary">
              <MatchHighlight path={r} query={query} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchHighlight({ path, query }: { path: string; query: string }) {
  if (!query) return <>{path}</>;
  const idx = path.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{path}</>;
  return (
    <>
      {path.slice(0, idx)}
      <span className="text-accent-hi font-medium">{path.slice(idx, idx + query.length)}</span>
      {path.slice(idx + query.length)}
    </>
  );
}
