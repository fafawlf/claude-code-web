import { useState } from 'react';
import type { PermissionMode, SessionStateSnapshot } from '../types';
import { modeLabel } from '../types';
import { CwdPicker } from './CwdPicker';
import { ModelMenu } from './ModelMenu';
import { Icon } from './Icon';

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
      <header className="h-11 shrink-0 px-4 flex items-center gap-1 text-sm bg-bg-base/70 backdrop-blur-[12px] border-b border-border-subtle sticky top-0 z-20">
        <span
          className={`w-2 h-2 rounded-full mr-2 transition-colors duration-hover ${p.connected ? 'bg-success shadow-[0_0_6px_rgba(138,168,118,.6)]' : 'bg-text-muted'}`}
          title={p.connected ? 'connected' : 'disconnected'}
        />

        <button onClick={() => setCwdOpen(true)} className="chip" title={s?.cwd ?? ''}>
          <Icon name="folder" size={14} className="opacity-80" />
          <span className="font-mono text-[11px]">{cwdShort}</span>
          <Icon name="chev-down" size={12} className="opacity-50" />
        </button>

        <Separator />

        <ModelMenu current={s?.model} onSelect={p.onSelectModel} />

        <Separator />

        <ModeMenu current={s?.permissionMode ?? 'default'} onSelect={p.onSelectMode} />

        <div className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
          {s?.claudeSessionId && (
            <span
              className="font-mono text-[10px] text-text-muted hover:text-text-secondary transition-colors duration-hover cursor-default px-1.5 py-0.5 rounded bg-bg-raised/60 border border-border-subtle"
              title={`Session ${s.claudeSessionId}`}
            >
              #{s.claudeSessionId.slice(0, 7)}
            </span>
          )}
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
              className="bg-bg-surface border border-border rounded-sm px-2 py-1 text-text-primary text-[11px] w-48 outline-none focus:border-accent"
              placeholder="Session title…"
            />
          ) : p.sessionTitle ? (
            <button onClick={() => { setRenaming(true); setDraft(p.sessionTitle ?? ''); }} className="px-2 py-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover max-w-[220px] truncate" title="rename">
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

function Separator() {
  return <div className="w-px h-3.5 bg-border-subtle mx-1.5" />;
}

function ModeMenu({ current, onSelect }: { current: PermissionMode; onSelect: (m: PermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const color = current === 'plan' ? 'text-warning' : current === 'acceptEdits' ? 'text-success' : 'text-text-secondary';
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={`chip ${color}`}>
        <span className={`w-1.5 h-1.5 rounded-full bg-current ${current !== 'default' ? 'shadow-[0_0_8px_currentColor]' : ''}`} />
        {modeLabel(current)}
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 w-60 z-20 bg-bg-surface border border-border rounded-md shadow-pop overflow-hidden animate-modal-in origin-top-left">
            {(['default', 'acceptEdits', 'plan'] as PermissionMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { onSelect(m); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-hover ${m === current ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
              >
                <span className="flex-1">{modeLabel(m)}</span>
                {m === current && <Icon name="check" size={12} className="text-accent" />}
              </button>
            ))}
            <div className="px-3 py-2 border-t border-border-subtle text-[10px] text-text-muted">
              Shift+Tab in input to cycle
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function shortPath(p: string): string {
  let s = p;
  const home = '/root'; // display-only heuristic
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
