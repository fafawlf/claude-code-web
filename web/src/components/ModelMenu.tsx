import { useState } from 'react';
import { MODEL_OPTIONS } from '../types';

type Props = {
  current?: string;
  onSelect: (modelId: string) => void;
};

export function ModelMenu({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const label = MODEL_OPTIONS.find((m) => current?.startsWith(m.id))?.label ?? current ?? 'default';
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="px-2 py-1 rounded hover:bg-zinc-900 text-xs text-zinc-300">
        🧠 {label} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 w-64 z-20 bg-zinc-900 border border-zinc-700 rounded shadow-xl text-sm overflow-hidden">
            {MODEL_OPTIONS.map((m) => {
              const active = current?.startsWith(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => { onSelect(m.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 hover:bg-zinc-800 flex items-center gap-2 ${active ? 'bg-zinc-800/60' : ''}`}
                >
                  <span className="flex-1">
                    <div className="text-zinc-100">{m.label}</div>
                    <div className="text-[10px] text-zinc-500">{m.hint}</div>
                  </span>
                  {active && <span className="text-emerald-400 text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
