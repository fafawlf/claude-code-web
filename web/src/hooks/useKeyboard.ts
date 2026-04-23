import { useEffect } from 'react';

export type KeyHandler = (e: KeyboardEvent) => void;

/** Register a global keydown handler. Handler receives the raw event; check modifiers yourself. */
export function useKeyboard(handler: KeyHandler, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handler, enabled]);
}

export function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}
