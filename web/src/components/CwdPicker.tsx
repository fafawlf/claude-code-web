import { useEffect, useState } from 'react';

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

  useEffect(() => {
    setErr(null);
    fetch(`/api/dirs?t=${encodeURIComponent(token)}&path=${encodeURIComponent(current)}`)
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((j: DirsResponse) => setData(j))
      .catch((e) => setErr(String(e.message || e)));
  }, [current, token]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-800">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Open project</div>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onPick(current); }}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-sm font-mono text-zinc-200"
              placeholder="/path/to/project"
            />
            <button onClick={() => onPick(current)} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm">Use this folder</button>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-y-auto text-sm">
          {err && <div className="p-4 text-red-400 text-sm">{err}</div>}
          {data && data.parent && (
            <button
              onClick={() => setCurrent(data.parent!)}
              className="w-full text-left px-4 py-2 hover:bg-zinc-800 border-b border-zinc-800 text-zinc-400 font-mono"
            >
              ← ..
            </button>
          )}
          {data?.dirs.length === 0 && <div className="p-4 text-zinc-500 text-xs">No subdirectories.</div>}
          {data?.dirs.map((d) => (
            <button
              key={d}
              onClick={() => setCurrent(data.path.replace(/\/$/, '') + '/' + d)}
              onDoubleClick={() => onPick(data.path.replace(/\/$/, '') + '/' + d)}
              className="w-full text-left px-4 py-2 hover:bg-zinc-800 font-mono text-zinc-200"
              title="double-click to open"
            >
              📁 {d}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-zinc-800 flex justify-end gap-2 text-sm">
          <button onClick={onClose} className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}
