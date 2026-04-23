import { useEffect, useMemo, useRef, useState } from 'react';
import type { PermissionMode, SessionStateSnapshot, StoredSession } from '../types';
import { MODEL_OPTIONS, modeLabel } from '../types';
import { Icon, type IconName } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';

type Action =
  | { kind: 'new-chat' }
  | { kind: 'open-cwd' }
  | { kind: 'rename' }
  | { kind: 'refresh' }
  | { kind: 'set-model'; id: string }
  | { kind: 'set-mode'; mode: PermissionMode }
  | { kind: 'resume'; claudeSessionId: string };

type Row = {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  icon: IconName;
  hint?: string;
  active?: boolean;
  action: Action;
};

type Props = {
  open: boolean;
  onClose: () => void;
  state: SessionStateSnapshot | null;
  sessions: StoredSession[];
  onAction: (a: Action) => void;
};

export function CommandPalette({ open, onClose, state, sessions, onAction }: Props) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(ref, onClose, open);

  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    out.push({ id: 'act:new', group: 'Actions', label: 'New chat', icon: 'plus', hint: '⌘N', action: { kind: 'new-chat' } });
    out.push({ id: 'act:cwd', group: 'Actions', label: 'Open folder…', icon: 'folder', hint: '⌘O', action: { kind: 'open-cwd' } });
    out.push({ id: 'act:rename', group: 'Actions', label: 'Rename current session', icon: 'pencil', action: { kind: 'rename' } });
    out.push({ id: 'act:refresh', group: 'Actions', label: 'Refresh history', icon: 'clock', action: { kind: 'refresh' } });

    for (const m of MODEL_OPTIONS) {
      const active = state?.model?.startsWith(m.id);
      out.push({
        id: `model:${m.id}`,
        group: 'Models',
        label: `Switch to ${m.label}`,
        subtitle: m.hint,
        icon: 'brain',
        active,
        hint: active ? 'active' : 'switch',
        action: { kind: 'set-model', id: m.id },
      });
    }

    for (const mode of ['default', 'acceptEdits', 'plan'] as PermissionMode[]) {
      const active = state?.permissionMode === mode;
      out.push({
        id: `mode:${mode}`,
        group: 'Modes',
        label: `Set mode: ${modeLabel(mode)}`,
        icon: mode === 'plan' ? 'sparkles' : mode === 'acceptEdits' ? 'zap' : 'shield',
        active,
        hint: active ? 'active' : 'switch',
        action: { kind: 'set-mode', mode },
      });
    }

    const recent = [...sessions].sort((a, b) => b.lastModified - a.lastModified).slice(0, 10);
    for (const s of recent) {
      const title = s.customTitle ?? s.summary ?? s.firstPrompt ?? '(untitled)';
      out.push({
        id: `s:${s.sessionId}`,
        group: 'Sessions',
        label: title,
        icon: 'list',
        hint: new Date(s.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        action: { kind: 'resume', claudeSessionId: s.sessionId },
      });
    }

    return out;
  }, [state, sessions]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) =>
      r.label.toLowerCase().includes(query) ||
      (r.subtitle ?? '').toLowerCase().includes(query) ||
      r.group.toLowerCase().includes(query)
    );
  }, [rows, q]);

  useEffect(() => { setI(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(v + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const row = filtered[i];
        if (row) { onAction(row.action); onClose(); }
      } else if (e.key === 'Escape') {
        e.preventDefault(); onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, filtered, i, onAction, onClose]);

  if (!open) return null;

  // Group rendering
  const groupsInOrder: string[] = [];
  const byGroup = new Map<string, Row[]>();
  for (const r of filtered) {
    if (!byGroup.has(r.group)) { byGroup.set(r.group, []); groupsInOrder.push(r.group); }
    byGroup.get(r.group)!.push(r);
  }

  let runningIdx = 0;

  return (
    <div className="fixed inset-0 z-[60] bg-[rgba(20,16,15,.55)] backdrop-blur-[8px] flex justify-center pt-[15vh] animate-backdrop-in" onClick={onClose}>
      <div
        ref={ref}
        className="w-[640px] max-h-[520px] bg-bg-surface rounded-lg shadow-modal overflow-hidden flex flex-col animate-modal-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border-subtle">
          <Icon name="search" size={18} className="text-text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search sessions…"
            className="flex-1 text-base text-text-primary outline-none bg-transparent"
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-5 py-8 text-sm text-text-muted text-center">No matches.</div>
          )}
          {groupsInOrder.map((g) => (
            <div key={g}>
              <div className="px-5 pt-3 pb-1 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">{g}</div>
              {byGroup.get(g)!.map((r) => {
                const idx = runningIdx++;
                const selected = idx === i;
                return (
                  <button
                    key={r.id}
                    onClick={() => { onAction(r.action); onClose(); }}
                    onMouseEnter={() => setI(idx)}
                    className={`w-full text-left px-5 py-2 flex items-center gap-3 transition-colors duration-hover ${selected ? 'bg-bg-hover' : ''}`}
                  >
                    <Icon name={r.icon} size={16} className={selected ? 'text-accent' : 'text-text-secondary'} />
                    <span className="flex-1 text-sm text-text-primary">
                      {r.label}
                      {r.subtitle && <span className="text-text-muted"> · {r.subtitle}</span>}
                    </span>
                    {r.active && <Icon name="check" size={14} className="text-accent" />}
                    {r.hint && <span className={`text-[11px] ${selected ? 'text-text-secondary' : 'text-text-muted'}`}>{r.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type { Action as CommandAction };
