import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(ref: RefObject<HTMLElement>, onEscape?: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const root = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables()[0];
    if (first) first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); return; }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const firstN = nodes[0];
      const lastN = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstN) { e.preventDefault(); lastN.focus(); }
      else if (!e.shiftKey && active === lastN) { e.preventDefault(); firstN.focus(); }
    };

    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
    };
  }, [ref, onEscape, enabled]);
}
