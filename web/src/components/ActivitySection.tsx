import { useState } from 'react';
import type { ActivitySessionViewModel, ActivitySummary, ActivityTone } from '../activity';
import { Icon, type IconName } from './Icon';

type Props = {
  summary: ActivitySummary;
  sessions: ActivitySessionViewModel[];
  onOpen: (sessionId: string, title?: string) => void;
  onEnd: (sessionId: string) => void;
};

const SUMMARY_TONE: Record<ActivityTone, string> = {
  neutral: 'border-border-subtle bg-bg-surface text-text-secondary hover:bg-bg-hover',
  info: 'border-accent/25 bg-bg-accent-soft text-accent-hi hover:border-accent/40',
  warning: 'border-warning/30 bg-warning/10 text-warning hover:border-warning/50',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:border-danger/60',
  success: 'border-success/30 bg-success/10 text-success hover:border-success/50',
};

const DOT_TONE: Record<ActivityTone, string> = {
  neutral: 'bg-text-muted',
  info: 'bg-accent',
  warning: 'bg-warning shadow-[0_0_8px_rgba(212,169,94,.55)]',
  danger: 'bg-danger',
  success: 'bg-success',
};

const STATUS_TONE: Record<ActivityTone, string> = {
  neutral: 'text-text-muted',
  info: 'text-accent',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
};

export function ActivitySection({ summary, sessions, onOpen, onEnd }: Props) {
  const [open, setOpen] = useState(false);
  if (summary.total === 0) return null;

  return (
    <div className="activity-section px-3 pb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`activity-trigger w-full flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm transition-colors duration-hover ${SUMMARY_TONE[summary.tone]}`}
        aria-expanded={open}
      >
        <span className="relative flex items-center justify-center w-2 h-2">
          {(summary.tone === 'warning' || summary.tone === 'info') && <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${DOT_TONE[summary.tone]}`} />}
          <span className={`relative w-1.5 h-1.5 rounded-full ${DOT_TONE[summary.tone]}`} />
        </span>
        <Icon name="list" size={14} className="opacity-80" />
        <span className="font-medium">Activity</span>
        <span className="ml-auto text-xs opacity-90">{summary.label}</span>
        <Icon name={open ? 'chev-down' : 'chev-right'} size={13} className="opacity-60" />
      </button>

      {open && (
        <div className="activity-popover mt-2 rounded-md border border-border-subtle bg-bg-surface shadow-pop overflow-hidden animate-modal-in origin-top">
          <div className="activity-popover-title px-3 py-2 border-b border-border-subtle text-[10px] uppercase tracking-[.06em] font-semibold text-text-muted">
            Background Activity
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {sessions.map((s) => (
              <ActivityRow key={s.sessionId} session={s} onOpen={onOpen} onEnd={onEnd} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ session, onOpen, onEnd }: { session: ActivitySessionViewModel; onOpen: Props['onOpen']; onEnd: Props['onEnd'] }) {
  return (
    <div className="activity-row group relative mx-1 my-px rounded-sm hover:bg-bg-hover transition-colors duration-hover">
      <button
        onClick={() => onOpen(session.sessionId, session.title)}
        className="w-full text-left px-3 py-2.5 rounded-sm pr-[4.7rem]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={statusIcon(session.status)} size={13} className={`${STATUS_TONE[session.tone]} shrink-0`} />
          <span className="text-sm text-text-primary truncate">{session.title}</span>
        </div>
        <div className="text-[11px] text-text-muted mt-0.5 truncate">
          <span className={STATUS_TONE[session.tone]}>{session.statusLabel}</span>
          <span> · {session.subtitle}</span>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onEnd(session.sessionId); }}
        className="activity-end absolute top-2 right-2 px-2 py-1 rounded-sm text-[11px] text-text-muted opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-base transition-all duration-hover"
        title="End this task"
      >
        End
      </button>
    </div>
  );
}

function statusIcon(status: ActivitySessionViewModel['status']): IconName {
  switch (status) {
    case 'needs_review': return 'shield';
    case 'plan_ready': return 'sparkles';
    case 'working': return 'brain';
    case 'issue': return 'zap';
    case 'finished': return 'check';
  }
}
