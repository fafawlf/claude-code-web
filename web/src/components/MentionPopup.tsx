import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { apiFetch } from '../api';

type Props = {
  token: string;
  cwd: string;
  query: string;
  onPick: (path: string) => void;
  onClose: () => void;
  onEmptySubmit: () => void;
};

type SearchStatus = 'loading' | 'ready' | 'error';

const SEARCH_DEBOUNCE_MS = 200;

export function MentionPopup({ token, cwd, query, onPick, onClose, onEmptySubmit }: Props) {
  const [results, setResults] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [status, setStatus] = useState<SearchStatus>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setResults([]);
    setI(0);
    const timer = window.setTimeout(() => {
      const url = `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}&limit=30`;
      apiFetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`File search failed (${response.status})`);
          return response.json();
        })
        .then((body) => {
          if (controller.signal.aborted) return;
          setResults(body.results ?? []);
          setStatus('ready');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus('error');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, cwd, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && results.length > 0) { e.preventDefault(); setI((v) => Math.min(v + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp' && results.length > 0) { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && results[i]) { e.preventDefault(); onPick(results[i]); }
      else if (e.key === 'Enter' && status !== 'loading') { e.preventDefault(); onEmptySubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [results, i, onPick, onClose, onEmptySubmit, status]);

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-w-md bg-bg-surface border border-border rounded-md shadow-pop overflow-hidden animate-modal-in origin-bottom-left">
      <div className="px-3.5 py-1.5 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted border-b border-border-subtle">Attach file</div>
      <div className="max-h-56 overflow-y-auto">
        {results.length === 0 && (
          <div className="px-3.5 py-3 text-xs text-text-muted" role="status">
            {status === 'loading'
              ? 'Searching files…'
              : status === 'error'
                ? 'File search failed. Press Enter to send as text.'
                : 'No matching files. Press Enter to send as text.'}
          </div>
        )}
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
