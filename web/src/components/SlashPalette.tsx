import { useEffect, useState } from 'react';
import type { PermissionMode } from '../types';
import { MODEL_OPTIONS } from '../types';

export type SlashAction =
  | { kind: 'new' }
  | { kind: 'cwd' }
  | { kind: 'model'; id: string }
  | { kind: 'mode'; mode: PermissionMode }
  | { kind: 'history' }
  | { kind: 'literal'; text: string };

type Props = {
  query: string;
  onPick: (a: SlashAction) => void;
  onClose: () => void;
};

type Cmd = { label: string; hint: string; action: SlashAction; match: string[] };

export function SlashPalette({ query, onPick, onClose }: Props) {
  const [i, setI] = useState(0);

  const cmds: Cmd[] = [
    { label: '/clear', hint: 'new chat', action: { kind: 'new' }, match: ['clear', 'new', 'reset'] },
    { label: '/cwd', hint: 'change project folder', action: { kind: 'cwd' }, match: ['cwd', 'folder', 'dir', 'project'] },
    { label: '/history', hint: 'show prior sessions', action: { kind: 'history' }, match: ['history', 'resume', 'sessions'] },
    ...MODEL_OPTIONS.map((m) => ({
      label: `/model ${m.label}`,
      hint: m.hint,
      action: { kind: 'model' as const, id: m.id },
      match: ['model', m.label.toLowerCase(), m.id],
    })),
    { label: '/mode default', hint: 'prompt before each tool', action: { kind: 'mode', mode: 'default' }, match: ['mode', 'default'] },
    { label: '/mode acceptEdits', hint: 'auto-allow file edits', action: { kind: 'mode', mode: 'acceptEdits' }, match: ['mode', 'accept', 'edits'] },
    { label: '/mode plan', hint: 'read-only plan mode', action: { kind: 'mode', mode: 'plan' }, match: ['mode', 'plan'] },
  ];

  const q = query.toLowerCase();
  const filtered = q
    ? cmds.filter((c) => c.label.toLowerCase().includes(q) || c.match.some((m) => m.includes(q)))
    : cmds;

  useEffect(() => { setI(0); }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(v + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (filtered[i]) onPick(filtered[i].action); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, i, onPick, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-w-md bg-bg-surface border border-border rounded-md shadow-pop overflow-hidden animate-modal-in origin-bottom-left">
      <div className="px-3.5 py-1.5 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted border-b border-border-subtle">Slash commands</div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.map((c, idx) => (
          <button
            key={c.label}
            onClick={() => onPick(c.action)}
            onMouseEnter={() => setI(idx)}
            className={`w-full text-left px-3.5 py-1.5 flex items-center gap-2 transition-colors duration-hover ${idx === i ? 'bg-bg-hover' : ''}`}
          >
            <span className="font-mono text-xs text-text-primary">{c.label}</span>
            <span className="text-[10px] text-text-muted ml-auto">{c.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
