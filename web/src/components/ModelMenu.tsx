import { useState } from 'react';
import { MODEL_OPTIONS } from '../types';
import { Icon } from './Icon';

type Props = {
  current?: string;
  onSelect: (modelId: string) => void;
};

export function ModelMenu({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const label = MODEL_OPTIONS.find((m) => current?.startsWith(m.id))?.label ?? current ?? 'default';
  return (
    <div className="topbar-menu relative">
      <button onClick={() => setOpen(!open)} className="chip">
        <Icon name="brain" size={14} className="opacity-80" />
        <span>{label}</span>
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="topbar-menu-popover absolute left-0 mt-1 w-64 z-20 bg-bg-surface border border-border rounded-md shadow-pop overflow-hidden animate-modal-in origin-top-left">
            {MODEL_OPTIONS.map((m) => {
              const active = current?.startsWith(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => { onSelect(m.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors duration-hover ${active ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
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
          </div>
        </>
      )}
    </div>
  );
}
