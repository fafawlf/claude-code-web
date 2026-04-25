import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
};

export function TopbarMenuPortal({ anchorRef, onClose, children }: Props) {
  const [style, setStyle] = useState<CSSProperties>(() => fallbackStyle());

  useEffect(() => {
    const update = () => setStyle(positionMenu(anchorRef.current));
    update();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[79]" onClick={onClose} />
      <div
        className="topbar-menu-popover fixed z-[80] w-64 overflow-y-auto rounded-md border border-border bg-bg-surface shadow-pop animate-modal-in origin-top-left"
        style={style}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

function positionMenu(anchor: HTMLElement | null): CSSProperties {
  if (!anchor || typeof window === 'undefined') return fallbackStyle();
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 10;
  const top = Math.max(margin, Math.round(rect.bottom + gap));

  if (window.innerWidth < 768) {
    return {
      ...fallbackStyle(),
      top,
      maxHeight: `calc(100dvh - ${top + margin}px)`,
    };
  }

  const width = 256;
  const left = Math.min(Math.max(margin, Math.round(rect.left)), Math.max(margin, window.innerWidth - width - margin));
  return {
    position: 'fixed',
    top,
    left,
    width,
    zIndex: 80,
    maxHeight: `calc(100dvh - ${top + margin}px)`,
  };
}

function fallbackStyle(): CSSProperties {
  return {
    position: 'fixed',
    top: 54,
    left: 10,
    right: 10,
    zIndex: 80,
    maxHeight: 'calc(100dvh - 72px)',
  };
}
