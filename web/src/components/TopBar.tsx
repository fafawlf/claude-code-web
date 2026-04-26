import { useState } from 'react';
import type { AgentProviderId, ClaudeAuthInfo, CodexAuthInfo, NodeInfo, SessionStateSnapshot } from '../types';
import type { SkinId } from '../skins';
import { AgentMenu } from './AgentMenu';
import { Icon } from './Icon';

type Props = {
  state: SessionStateSnapshot | null;
  cwd: string;
  auth?: ClaudeAuthInfo | null;
  codexAuth?: CodexAuthInfo | null;
  codexDefaultModel?: string;
  nodes?: NodeInfo[];
  selectedNodeId?: string;
  selectedProvider?: AgentProviderId;
  onOpenSidebar?: () => void;
  onOpenProject: () => void;
  onSelectNodeProvider: (nodeId: string, provider: AgentProviderId) => void;
  onSelectModel: (model: string) => void;
  skin: SkinId;
  onSelectSkin: (skin: SkinId) => void;
  onRename: (title: string) => void;
  onContinueWriting?: () => void;
  onRefreshHistory?: () => void;
  sessionTitle?: string;
  connected: boolean;
};

export function TopBar(p: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(p.sessionTitle ?? '');
  const s = p.state;

  const cwdShort = p.cwd ? shortPath(p.cwd) : '…';
  const currentProvider = s?.provider ?? p.selectedProvider;
  const currentNodeId = s?.nodeId ?? p.selectedNodeId;

  return (
    <>
      <header className={`app-topbar skin-topbar-${p.skin} h-11 shrink-0 px-4 flex items-center gap-1 text-sm bg-bg-base/70 backdrop-blur-[12px] border-b border-border-subtle sticky top-0 z-20`}>
        <span
          className={`w-2 h-2 rounded-full mr-2 transition-colors duration-hover ${p.connected ? 'bg-success shadow-[0_0_6px_rgba(138,168,118,.6)]' : 'bg-text-muted'}`}
          title={p.connected ? 'connected' : 'disconnected'}
        />

        {p.onOpenSidebar && (
          <button
            onClick={p.onOpenSidebar}
            className="mobile-sidebar-button chip"
            title="Open projects"
            aria-label="Open projects"
          >
            <Icon name="list" size={15} className="opacity-80" />
          </button>
        )}

        <button onClick={p.onOpenProject} className="chip" title={p.cwd}>
          <Icon name="folder" size={14} className="opacity-80" />
          <span className="font-mono text-[11px]">{cwdShort}</span>
          <Icon name="chev-down" size={12} className="opacity-50" />
        </button>

        <AgentMenu
          nodes={p.nodes ?? []}
          currentNodeId={currentNodeId}
          currentProvider={currentProvider}
          currentModel={s?.model}
          codexDefaultModel={p.codexDefaultModel}
          auth={p.auth}
          codexAuth={p.codexAuth}
          skin={p.skin}
          onSelectNodeProvider={p.onSelectNodeProvider}
          onSelectModel={p.onSelectModel}
          onSelectSkin={p.onSelectSkin}
        />

        <div className="ml-auto flex items-center gap-3 text-[11px] text-text-muted">
          {s?.viewerMode && (
            <>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning/10 text-warning border border-warning/30">
                <span className="w-1 h-1 rounded-full bg-warning" />
                Read-only
              </span>
              {p.onRefreshHistory && (
                <button
                  onClick={p.onRefreshHistory}
                  className="text-[11px] px-2 py-1 rounded bg-bg-hover hover:bg-bg-surface text-text-secondary hover:text-text-primary transition-colors duration-hover"
                  title="Re-read transcript from disk"
                >↻ Refresh</button>
              )}
              {p.onContinueWriting && (
                <button
                  onClick={p.onContinueWriting}
                  className="text-[11px] px-2.5 py-1 rounded bg-accent hover:bg-accent-hi text-text-inverse font-medium transition-colors duration-hover"
                  title="Take over and continue writing in this session (may conflict if another Claude Code is still attached)"
                >Continue writing →</button>
              )}
            </>
          )}
          {(s?.providerSessionId ?? s?.claudeSessionId) && (
            <span
              className="session-id-pill font-mono text-[10px] text-text-muted hover:text-text-secondary transition-colors duration-hover cursor-default px-1.5 py-0.5 rounded bg-bg-raised/60 border border-border-subtle"
              title={`Session ${s.providerSessionId ?? s.claudeSessionId}`}
            >
              #{(s.providerSessionId ?? s.claudeSessionId)!.slice(0, 7)}
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
            <button onClick={() => { setRenaming(true); setDraft(p.sessionTitle ?? ''); }} className="topbar-session-title px-2 py-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover max-w-[220px] truncate" title="rename">
              {p.sessionTitle}
            </button>
          ) : null}
        </div>
      </header>

    </>
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
