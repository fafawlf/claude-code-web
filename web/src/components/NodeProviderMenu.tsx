import { useRef, useState } from 'react';
import type { AgentProviderId, NodeInfo } from '../types';
import { providerLabel } from '../types';
import { Icon } from './Icon';
import { TopbarMenuPortal } from './TopbarMenuPortal';

type Props = {
  nodes: NodeInfo[];
  currentNodeId?: string;
  currentProvider?: AgentProviderId;
  defaultOpen?: boolean;
  onSelect: (nodeId: string, provider: AgentProviderId) => void;
};

export function NodeProviderMenu({ nodes, currentNodeId, currentProvider, defaultOpen = false, onSelect }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const currentNode = nodes.find((n) => n.id === currentNodeId) ?? nodes[0];
  const provider = currentProvider ?? currentNode?.providers[0] ?? 'claude';
  const label = currentNode ? `${currentNode.label} · ${providerLabel(provider)}` : providerLabel(provider);

  return (
    <div className="topbar-menu relative">
      <button ref={buttonRef} onClick={() => setOpen(!open)} className="chip" aria-expanded={open} aria-haspopup="menu" title="Choose node and agent">
        <Icon name="terminal" size={14} className="opacity-80" />
        <span className="node-provider-label">{label}</span>
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)}>
          <div className="min-w-[260px] py-1">
            {nodes.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted">No nodes available.</div>
            ) : nodes.map((node) => (
              <div key={node.id} className="px-2 py-2 border-b border-border-subtle last:border-b-0">
                <div className="px-1 pb-1.5 flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${node.connected ? 'bg-success' : 'bg-text-muted'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">{node.label}</div>
                    <div className="truncate text-[10px] text-text-muted">{node.kind === 'local' ? 'server runtime' : 'ssh node'} · {node.defaultCwd}</div>
                  </div>
                  {node.id === currentNodeId && <Icon name="check" size={12} className="text-accent" />}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {node.providers.map((p) => {
                    const active = node.id === currentNodeId && p === currentProvider;
                    return (
                      <button
                        key={`${node.id}:${p}`}
                        onClick={() => { onSelect(node.id, p); setOpen(false); }}
                        className={`rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors duration-hover ${active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                        role="menuitem"
                        title={`${providerLabel(p)} on ${node.label}`}
                      >
                        {providerLabel(p)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </TopbarMenuPortal>
      )}
    </div>
  );
}
