import type { ActiveToolInfo, ChatItem } from '../types';
import type { SkinId } from '../skins';
import type { ConnectionState } from '../ws';
import { Icon, type IconName } from './Icon';
import { contentForSkin, statusCopyForSkin } from '../skinContent';

type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export type StatusKind =
  | { kind: 'idle' }
  | { kind: 'connection-lost' }
  | { kind: 'reconnecting' }
  | { kind: 'plan-approval' }
  | { kind: 'approval-needed'; count: number }
  | { kind: 'running-tool'; name: string; seconds: number; inputSummary?: string }
  | { kind: 'writing' }
  | { kind: 'thinking' }
  | { kind: 'stalled'; seconds: number };

type Props = {
  connection: ConnectionState;
  busy: boolean;
  streamingText: string;
  items: ChatItem[];
  activeTool?: ActiveToolInfo;
  hasPermReq: boolean;
  pendingEditCount: number;
  hasPlan: boolean;
  secondsSinceLastEvent: number;
  skin?: SkinId;
  onFocusPending?: () => void;
  onStop?: () => void;
};

const TOOLS_MAP: Record<string, IconName> = { Bash: 'terminal', Edit: 'pencil', Write: 'pencil', Read: 'file', Grep: 'search', Glob: 'search' };

export function deriveStatus(p: Props): StatusKind {
  if (p.connection === 'closed') return { kind: 'connection-lost' };
  if (p.connection === 'reconnecting' || p.connection === 'connecting') return { kind: 'reconnecting' };
  if (p.hasPlan) return { kind: 'plan-approval' };
  if (p.hasPermReq || p.pendingEditCount > 0) {
    return { kind: 'approval-needed', count: (p.hasPermReq ? 1 : 0) + p.pendingEditCount };
  }
  if (!p.busy) return { kind: 'idle' };
  if (p.busy && p.streamingText) return { kind: 'writing' };
  if (p.activeTool) return {
    kind: 'running-tool',
    name: p.activeTool.name,
    seconds: p.secondsSinceLastEvent,
    inputSummary: p.activeTool.inputSummary,
  };
  // Busy but no stream: maybe a tool is running. Find the tail-most tool_use without a result.
  for (let i = p.items.length - 1; i >= 0; i--) {
    const it = p.items[i];
    if (it.kind === 'tool_use' && !it.result) {
      return { kind: 'running-tool', name: it.name, seconds: p.secondsSinceLastEvent };
    }
    if (it.kind === 'assistant_text' || it.kind === 'user') break;
  }
  if (p.busy && p.secondsSinceLastEvent >= 15) return { kind: 'stalled', seconds: p.secondsSinceLastEvent };
  return { kind: 'thinking' };
}

function kindToView(k: StatusKind, skin: SkinId): { tone: Tone; icon: IconName; label: string; pulse?: boolean; hint?: string } | null {
  const copy = statusCopyForSkin(skin, k);
  switch (k.kind) {
    case 'idle': return null;
    case 'connection-lost': return { tone: 'danger', icon: 'zap', label: copy.label };
    case 'reconnecting': return { tone: 'warning', icon: 'zap', label: copy.label, pulse: true };
    case 'plan-approval': return { tone: 'warning', icon: 'sparkles', label: copy.label, pulse: true };
    case 'approval-needed':
      return { tone: 'warning', icon: 'shield', label: copy.label, pulse: true };
    case 'running-tool': {
      const icon = TOOLS_MAP[k.name] ?? 'code';
      return { tone: 'info', icon, label: copy.label, pulse: true, hint: copy.hint };
    }
    case 'writing': return { tone: 'info', icon: 'sparkles', label: copy.label, pulse: true };
    case 'stalled': return { tone: 'warning', icon: 'clock', label: copy.label, pulse: true, hint: copy.hint };
    case 'thinking': return { tone: 'info', icon: 'brain', label: copy.label, pulse: true, hint: copy.hint };
  }
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-border-subtle bg-bg-raised/40 text-text-secondary',
  info:    'border-border-subtle bg-bg-raised/40 text-text-secondary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger:  'border-danger/40 bg-danger/10 text-danger',
};

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-text-muted',
  info:    'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger:  'bg-danger',
};

export function StatusBar(p: Props) {
  const skin = p.skin ?? 'warm';
  const content = contentForSkin(skin);
  const k = deriveStatus(p);
  const view = kindToView(k, skin);
  if (!view) return null;
  const showButton = (k.kind === 'plan-approval' || k.kind === 'approval-needed') && !!p.onFocusPending;
  const showStop = (k.kind === 'stalled' || k.kind === 'running-tool') && !!p.onStop;

  return (
    <div
      className={`skin-status skin-status-${skin} mx-auto w-full max-w-[720px] flex items-center gap-2.5 px-3.5 py-1.5 border rounded-full text-[12px] transition-colors duration-hover ${TONE_CLASSES[view.tone]}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex items-center justify-center w-2 h-2">
        <span className={`absolute inset-0 rounded-full ${DOT_CLASSES[view.tone]} ${view.pulse ? 'animate-ping opacity-60' : ''}`} />
        <span className={`relative w-1.5 h-1.5 rounded-full ${DOT_CLASSES[view.tone]}`} />
      </span>
      <Icon name={view.icon} size={13} className="opacity-80 shrink-0" />
      <span className="truncate flex-1">{view.label}</span>
      {view.hint && <span className="text-text-muted text-[11px]">{view.hint}</span>}
      {showButton && (
        <button
          onClick={p.onFocusPending}
          className="text-[11px] px-2 py-0.5 rounded bg-current/10 hover:bg-current/20 transition-colors duration-hover font-medium"
        >
          {content.status.review} →
        </button>
      )}
      {showStop && (
        <button
          onClick={p.onStop}
          className="text-[11px] px-2 py-0.5 rounded bg-current/10 hover:bg-current/20 transition-colors duration-hover font-medium"
        >
          {content.status.stop}
        </button>
      )}
    </div>
  );
}
