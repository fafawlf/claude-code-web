import type { PermissionMode } from '../types';
import { modeLabel } from '../types';

type Props = { mode: PermissionMode };

export function ModeStrip({ mode }: Props) {
  if (mode === 'default') return null;
  const isPlan = mode === 'plan';
  const isAccept = mode === 'acceptEdits';
  const color = isPlan ? 'bg-amber-500/10 text-amber-300 border-amber-900/50'
    : isAccept ? 'bg-emerald-500/10 text-emerald-300 border-emerald-900/50'
    : 'bg-red-500/10 text-red-300 border-red-900/50';
  const icon = isPlan ? '⏸' : isAccept ? '⏵⏵' : '⚠︎';
  const hint = isPlan ? 'read-only — Claude will propose a plan, you approve to execute'
    : isAccept ? 'file edits auto-allowed — Bash still prompts'
    : 'all permissions bypassed';
  return (
    <div className={`border-t ${color} px-4 py-1.5 text-xs flex items-center gap-3`}>
      <span className="font-semibold tracking-wide">{icon} {modeLabel(mode)} on</span>
      <span className="opacity-80">{hint}</span>
    </div>
  );
}
