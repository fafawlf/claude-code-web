import { useState } from 'react';
import type { PermissionMode, SessionStateSnapshot } from '../types';
import { modeLabel } from '../types';
import { CwdPicker } from './CwdPicker';
import { ModelMenu } from './ModelMenu';

type Props = {
  state: SessionStateSnapshot | null;
  token: string;
  cwdPickerOpen: boolean;
  setCwdPickerOpen: (open: boolean) => void;
  onSelectCwd: (cwd: string) => void;
  onSelectModel: (model: string) => void;
  onSelectMode: (mode: PermissionMode) => void;
  onRename: (title: string) => void;
  sessionTitle?: string;
  connected: boolean;
};

export function TopBar(p: Props) {
  const { cwdPickerOpen: cwdOpen, setCwdPickerOpen: setCwdOpen } = p;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(p.sessionTitle ?? '');
  const s = p.state;

  const cwdShort = s?.cwd ? shortPath(s.cwd) : '…';
  const tok = s ? formatTokens(s.tokensIn + s.tokensOut) : '—';
  const cost = s?.cost ? `$${s.cost.toFixed(3)}` : null;

  return (
    <>
      <header className="h-12 shrink-0 border-b border-zinc-800 bg-zinc-950 px-3 flex items-center gap-2 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} title={p.connected ? 'connected' : 'disconnected'} />

        <button
          onClick={() => setCwdOpen(true)}
          className="px-2 py-1 rounded hover:bg-zinc-900 font-mono text-zinc-300 text-xs max-w-[280px] truncate"
          title={s?.cwd ?? ''}
        >
          📁 {cwdShort}
        </button>

        <span className="text-zinc-700">·</span>

        <ModelMenu
          current={s?.model}
          onSelect={p.onSelectModel}
        />

        <span className="text-zinc-700">·</span>

        <ModeMenu
          current={s?.permissionMode ?? 'default'}
          onSelect={p.onSelectMode}
        />

        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft.trim()) p.onRename(draft.trim()); setRenaming(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.currentTarget.blur(); }
                if (e.key === 'Escape') { setRenaming(false); setDraft(p.sessionTitle ?? ''); }
              }}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 text-xs w-48"
              placeholder="Session title…"
            />
          ) : p.sessionTitle ? (
            <button onClick={() => { setRenaming(true); setDraft(p.sessionTitle ?? ''); }} className="hover:text-zinc-300 truncate max-w-[200px]" title="rename">
              {p.sessionTitle}
            </button>
          ) : null}
          <span title="tokens in + out">{tok} tok</span>
          {cost && <span title="session cost">{cost}</span>}
        </div>
      </header>

      {cwdOpen && s && (
        <CwdPicker
          token={p.token}
          initial={s.cwd}
          onClose={() => setCwdOpen(false)}
          onPick={(path) => { setCwdOpen(false); p.onSelectCwd(path); }}
        />
      )}
    </>
  );
}

function ModeMenu({ current, onSelect }: { current: PermissionMode; onSelect: (m: PermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const color = current === 'plan' ? 'text-amber-400' : current === 'acceptEdits' ? 'text-emerald-400' : 'text-zinc-300';
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={`px-2 py-1 rounded hover:bg-zinc-900 text-xs ${color}`}>
        ⏵ {modeLabel(current)} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 w-56 z-20 bg-zinc-900 border border-zinc-700 rounded shadow-xl text-sm overflow-hidden">
            {(['default', 'acceptEdits', 'plan'] as PermissionMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { onSelect(m); setOpen(false); }}
                className={`w-full text-left px-3 py-2 hover:bg-zinc-800 flex items-center gap-2 ${m === current ? 'bg-zinc-800/60' : ''}`}
              >
                <span className="flex-1">{modeLabel(m)}</span>
                {m === current && <span className="text-emerald-400 text-xs">✓</span>}
              </button>
            ))}
            <div className="px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-500">
              Shift+Tab in input to cycle
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function shortPath(p: string): string {
  const home = '/root'; // UI-only hint; real paths come from server
  let s = p;
  if (s.startsWith(home)) s = '~' + s.slice(home.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 3) return s;
  return (s.startsWith('~') ? '~/' : '/') + '…/' + parts.slice(-2).join('/');
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}
