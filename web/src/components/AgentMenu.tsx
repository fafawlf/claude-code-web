import { useRef, useState } from 'react';
import type { AgentProviderId, ClaudeAuthInfo, CodexAuthInfo, NodeInfo } from '../types';
import { modelLabel, modelOptionsForProvider, providerLabel } from '../types';
import type { SkinId } from '../skins';
import { SKINS, skinById } from '../skins';
import { Icon } from './Icon';
import { TopbarMenuPortal } from './TopbarMenuPortal';

type AuthInfo = ClaudeAuthInfo | CodexAuthInfo;

type Props = {
  nodes: NodeInfo[];
  currentNodeId?: string;
  currentProvider?: AgentProviderId;
  currentModel?: string;
  codexDefaultModel?: string;
  auth?: ClaudeAuthInfo | null;
  codexAuth?: CodexAuthInfo | null;
  skin: SkinId;
  onSelectNodeProvider: (nodeId: string, provider: AgentProviderId) => void;
  onSelectModel: (modelId: string) => void;
  onSelectSkin: (skin: SkinId) => void;
};

export function AgentMenu({
  nodes,
  currentNodeId,
  currentProvider,
  currentModel,
  codexDefaultModel,
  auth,
  codexAuth,
  skin,
  onSelectNodeProvider,
  onSelectModel,
  onSelectSkin,
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const currentNode = nodes.find((n) => n.id === currentNodeId) ?? nodes[0];
  const provider = currentProvider ?? currentNode?.providers[0] ?? 'claude';
  const fallbackModel = provider === 'codex' ? codexDefaultModel : undefined;
  const label = `${providerLabel(provider)} · ${modelLabel(provider, currentModel, fallbackModel)}`;
  const activeAuth = provider === 'codex' ? codexAuth : auth;

  return (
    <div className="topbar-menu relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="chip agent-menu-chip"
        aria-expanded={open}
        aria-haspopup="menu"
        title={currentNode?.label ?? 'Agent settings'}
      >
        <Icon name={provider === 'codex' ? 'code' : 'terminal'} size={14} className="opacity-80" />
        <span className="agent-menu-label">{label}</span>
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)} width={320}>
          <div className="agent-menu-panel py-2">
            <Section title="Workspace">
              {nodes.length === 0 ? (
                <div className="px-3 py-2 text-sm text-text-muted">No nodes available.</div>
              ) : nodes.map((node) => (
                <div key={node.id} className="px-2 py-2">
                  <div className="px-1 pb-1.5 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${node.connected ? 'bg-success' : 'bg-text-muted'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">{node.label}</div>
                      <div className="truncate text-[10px] text-text-muted">{node.kind === 'local' ? 'this machine' : 'ssh node'} · {node.defaultCwd}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {node.providers.map((p) => {
                      const active = node.id === currentNodeId && p === provider;
                      return (
                        <button
                          key={`${node.id}:${p}`}
                          onClick={() => { onSelectNodeProvider(node.id, p); setOpen(false); }}
                          className={`rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors duration-hover ${active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                          role="menuitem"
                        >
                          {providerLabel(p)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Section>

            <Section title="Model">
              {modelOptionsForProvider(provider).map((m) => {
                const active = currentModel ? currentModel.startsWith(m.id) : fallbackModel?.startsWith(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => { onSelectModel(m.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors duration-hover ${active ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
                    role="menuitem"
                  >
                    <Icon name="brain" size={14} className={active ? 'text-accent' : 'text-text-muted'} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text-primary">{m.label}</span>
                      <span className="block text-[10px] text-text-muted">{m.hint}</span>
                    </span>
                    {active && <Icon name="check" size={12} className="text-accent" />}
                  </button>
                );
              })}
            </Section>

            <Section title="Skin">
              <div className="grid grid-cols-2 gap-1 px-2">
                {SKINS.map((item) => {
                  const active = item.id === skin;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { onSelectSkin(item.id); setOpen(false); }}
                      className={`rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-hover ${active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                      role="menuitem"
                      title={item.hint}
                    >
                      <span className="mr-1.5 inline-flex overflow-hidden rounded-full border border-border-subtle align-[-2px]">
                        {item.swatches.slice(0, 3).map((color) => <span key={color} className="h-3 w-2.5" style={{ backgroundColor: color }} />)}
                      </span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </Section>

            {activeAuth && (
              <div className="mx-2 mt-2 rounded-md border border-border-subtle bg-bg-base/45 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[.06em] text-text-muted">Account</div>
                <div className={`mt-1 flex items-center gap-2 text-sm ${authTone(activeAuth)}`}>
                  <Icon name={provider === 'codex' ? 'code' : 'shield'} size={14} />
                  <span>{activeAuth.label}</span>
                </div>
                {activeAuth.detail && <div className="mt-0.5 truncate text-[11px] text-text-muted" title={activeAuth.detail}>{activeAuth.detail}</div>}
              </div>
            )}

            <div className="px-3 pt-2 text-[10px] text-text-muted">Current skin: {skinById(skin).label}</div>
          </div>
        </TopbarMenuPortal>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border-subtle pb-2 mb-2 last:border-b-0 last:mb-0">
      <div className="px-3 pb-1 text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">{title}</div>
      {children}
    </section>
  );
}

function authTone(auth: AuthInfo): string {
  if (auth.source === 'none') return 'text-danger';
  if ('plan' in auth && auth.plan === 'pro') return 'text-success';
  if ('plan' in auth && auth.plan === 'max') return 'text-warning';
  if (auth.source === 'api') return 'text-accent-hi';
  return 'text-text-primary';
}
