import type { PermissionMode } from '../types';
import { modeLabel } from '../types';

type Props = { mode: PermissionMode };

// Inline in the InputBar's meta row now — no longer a full-width strip.
export function ModeDot({ mode }: Props) {
  if (mode === 'default') return null;
  const isPlan = mode === 'plan';
  const isAccept = mode === 'acceptEdits';
  const color = isPlan ? 'bg-warning shadow-[0_0_8px_rgba(212,169,94,.6)]'
    : isAccept ? 'bg-success shadow-[0_0_8px_rgba(138,168,118,.6)]'
    : 'bg-danger';
  const textColor = isPlan ? 'text-warning' : isAccept ? 'text-success' : 'text-danger';
  const hint = isPlan ? 'read-only — propose a plan' : isAccept ? 'file edits auto-allowed' : 'all permissions bypassed';
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-mode ease-soft ${color}`} />
      <span className={`font-medium ${textColor}`}>{modeLabel(mode)}</span>
      <span className="text-text-muted">· {hint}</span>
    </div>
  );
}

// Back-compat export so old imports keep working during migration.
export function ModeStrip({ mode }: Props) { return <ModeDot mode={mode} />; }
