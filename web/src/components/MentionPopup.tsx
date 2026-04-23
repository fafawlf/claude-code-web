import { useEffect, useState } from 'react';

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
    const url = `/api/files?t=${encodeURIComponent(token)}&cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}&limit=30`;
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
    <div className="absolute bottom-full mb-2 left-0 right-0 max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">Attach file</div>
      <div className="max-h-56 overflow-y-auto">
        {results.map((r, idx) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            onMouseEnter={() => setI(idx)}
            className={`w-full text-left px-3 py-1 font-mono text-xs ${idx === i ? 'bg-zinc-800' : ''}`}
          >
            <span className="text-zinc-200">{r}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
