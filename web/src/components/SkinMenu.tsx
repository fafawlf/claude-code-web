import type { SkinId } from '../skins';
import { SKINS, skinById } from '../skins';
import { Icon } from './Icon';
import { useRef, useState } from 'react';
import { TopbarMenuPortal } from './TopbarMenuPortal';

type Props = {
  current: SkinId;
  onSelect: (skin: SkinId) => void;
};

export function SkinMenu({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = skinById(current);
  return (
    <div className="topbar-menu relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="chip"
        title="Change skin"
        aria-label="Change skin"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon name="palette" size={14} className="opacity-80" />
        <span>{active.label}</span>
        <Icon name="chev-down" size={12} className="opacity-50" />
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)}>
          {SKINS.map((skin) => {
            const selected = skin.id === current;
            return (
              <button
                key={skin.id}
                onClick={() => { onSelect(skin.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors duration-hover ${selected ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
                role="menuitem"
              >
                <span className="flex shrink-0 overflow-hidden rounded-full border border-border-subtle">
                  {skin.swatches.map((color) => (
                    <span key={color} className="h-4 w-3" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary">{skin.label}</span>
                  <span className="block text-[10px] text-text-muted">{skin.hint}</span>
                </span>
                {selected && <Icon name="check" size={12} className="text-accent" />}
              </button>
            );
          })}
        </TopbarMenuPortal>
      )}
    </div>
  );
}
