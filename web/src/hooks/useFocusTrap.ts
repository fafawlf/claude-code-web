import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  onEscape?: () => void,
  enabled = true,
  initialFocusRef?: RefObject<HTMLElement>,
) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const root = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const focusFirst = () => {
      const target = initialFocusRef?.current ?? focusables()[0] ?? root;
      target.focus();
    };
    focusFirst();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstN = nodes[0];
      const lastN = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === firstN || !root.contains(active))) { e.preventDefault(); lastN.focus(); }
      else if (!e.shiftKey && (active === lastN || !root.contains(active))) { e.preventDefault(); firstN.focus(); }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!root.contains(e.target as Node)) focusFirst();
    };

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      // The app's inert background is released by a sibling effect cleanup.
      // Restore on the next microtask so the opener is focusable again first.
      queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus?.focus?.();
      });
    };
  }, [enabled, initialFocusRef, ref]);
}
