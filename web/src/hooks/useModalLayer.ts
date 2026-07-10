import { useEffect } from 'react';

export type TopLevelModal = 'setup' | 'permission' | 'plan' | 'project' | 'palette';

export type TopLevelModalFlags = Record<TopLevelModal, boolean>;

/** Resolve the one dialog that may be exposed to assistive technology. */
export function resolveTopLevelModal(flags: TopLevelModalFlags): TopLevelModal | null {
  if (flags.setup) return 'setup';
  if (flags.permission) return 'permission';
  if (flags.plan) return 'plan';
  if (flags.project) return 'project';
  if (flags.palette) return 'palette';
  return null;
}

export function blocksGlobalAppShortcuts(modal: TopLevelModal | null): boolean {
  return modal !== null;
}

/** Hide and disable the application surface while its sibling dialog is active. */
export function useModalBackground(
  root: HTMLElement | null,
  active: boolean,
): void {
  useEffect(() => {
    if (!root || !active) return;

    const hadAriaHidden = root.hasAttribute('aria-hidden');
    const previousAriaHidden = root.getAttribute('aria-hidden');
    const supportsInert = 'inert' in root;
    const previousInert = supportsInert
      ? (root as HTMLElement & { inert: boolean }).inert
      : false;

    root.setAttribute('aria-hidden', 'true');
    if (supportsInert) (root as HTMLElement & { inert: boolean }).inert = true;

    return () => {
      if (hadAriaHidden) root.setAttribute('aria-hidden', previousAriaHidden ?? 'true');
      else root.removeAttribute('aria-hidden');
      if (supportsInert) (root as HTMLElement & { inert: boolean }).inert = previousInert;
    };
  }, [active, root]);
}
