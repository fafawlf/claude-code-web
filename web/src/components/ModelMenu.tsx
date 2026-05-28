import { useRef, useState } from 'react';
import { defaultModelForProvider, modelLabel, modelOptionsForProvider, type AgentProviderId } from '../types';
import { Icon } from './Icon';
import { TopbarMenuPortal } from './TopbarMenuPortal';

type Props = {
  current?: string;
  provider?: AgentProviderId;
  onSelect: (modelId: string) => void;
};

export function ModelMenu({ current, provider, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const options = modelOptionsForProvider(provider);
  const effective = current ?? defaultModelForProvider(provider);
  const label = modelLabel(provider, current);
  return (
    <div className="topbar-menu relative">
      <button ref={buttonRef} onClick={() => setOpen(!open)} className="chip" aria-expanded={open} aria-haspopup="menu">
        <Icon name="brain" size={14} className="opacity-80" />
        <span>{label}</span>
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)}>
          {options.map((m) => {
            const active = effective?.startsWith(m.id);
            return (
              <button
                key={m.id}
                onClick={() => { onSelect(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors duration-hover ${active ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
                role="menuitem"
              >
                <Icon name="brain" size={14} className={active ? 'text-accent' : 'text-text-muted'} />
                <span className="flex-1">
                  <div className="text-sm text-text-primary">{m.label}</div>
                  <div className="text-[10px] text-text-muted">{m.hint}</div>
                </span>
                {active && <Icon name="check" size={12} className="text-accent" />}
              </button>
            );
          })}
        </TopbarMenuPortal>
      )}
    </div>
  );
}
