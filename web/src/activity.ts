import type { ChatState } from './reducer';
import type { ChatItem, SessionRuntimeStatus, SessionStateSnapshot, StoredSession } from './types';
import { cachedChatState } from './sessionCache';

export type ActivityStatus = 'needs_review' | 'plan_ready' | 'working' | 'issue' | 'finished';
export type ActivityTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export type ActivitySessionViewModel = {
  sessionId: string;
  nodeId: string;
  provider: SessionStateSnapshot['provider'];
  title: string;
  subtitle: string;
  status: ActivityStatus;
  statusLabel: string;
  tone: ActivityTone;
  lastEventAt: number;
};

export type ActivitySummary = {
  total: number;
  label: string;
  tone: ActivityTone;
  needsReviewCount: number;
  workingCount: number;
  issueCount: number;
  finishedCount: number;
};

type DeriveArgs = {
  liveSessions: SessionStateSnapshot[];
  activeSessionId: string | null;
  cache: Map<string, ChatState>;
  storedSessions: StoredSession[];
  now?: number;
};

const STATUS_PRIORITY: Record<ActivityStatus, number> = {
  needs_review: 0,
  plan_ready: 1,
  working: 2,
  issue: 3,
  finished: 4,
};

export function deriveActivitySessions({ liveSessions, activeSessionId, cache, storedSessions, now = Date.now() }: DeriveArgs): ActivitySessionViewModel[] {
  const storedByClaudeId = new Map(storedSessions.map((s) => [s.sessionId, s]));

  return dedupeActivitySnapshots(liveSessions
    .filter((s) => shouldShowActivitySession(s, activeSessionId, cachedChatState(cache, s), s.claudeSessionId ? storedByClaudeId.get(s.claudeSessionId) : undefined))
  )
    .map((s) => {
      const status = activityStatus(s.runtimeStatus);
      return {
        sessionId: s.sessionId,
        nodeId: s.nodeId,
        provider: s.provider,
        title: activityTitle(s, cachedChatState(cache, s), s.claudeSessionId ? storedByClaudeId.get(s.claudeSessionId) : undefined, now),
        subtitle: activitySubtitle(s, now),
        status,
        statusLabel: activityStatusLabel(s.runtimeStatus),
        tone: activityTone(status),
        lastEventAt: s.lastEventAt,
      };
    })
    .sort((a, b) => {
      const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (byStatus !== 0) return byStatus;
      return b.lastEventAt - a.lastEventAt;
    });
}

function dedupeActivitySnapshots(sessions: SessionStateSnapshot[]): SessionStateSnapshot[] {
  const byTask = new Map<string, SessionStateSnapshot>();
  for (const session of sessions) {
    const key = activityTaskKey(session);
    const prev = byTask.get(key);
    if (!prev || preferActivitySnapshot(session, prev)) byTask.set(key, session);
  }
  return [...byTask.values()];
}

function activityTaskKey(s: SessionStateSnapshot): string {
  const providerSessionId = s.providerSessionId ?? s.claudeSessionId;
  if (!providerSessionId) return `live:${s.sessionId}`;
  return `${s.nodeId ?? 'local'}:${s.provider ?? 'claude'}:${s.cwd}:${providerSessionId}`;
}

function preferActivitySnapshot(next: SessionStateSnapshot, prev: SessionStateSnapshot): boolean {
  const nextPriority = STATUS_PRIORITY[activityStatus(next.runtimeStatus)];
  const prevPriority = STATUS_PRIORITY[activityStatus(prev.runtimeStatus)];
  if (nextPriority !== prevPriority) return nextPriority < prevPriority;
  if (next.lastEventId !== prev.lastEventId) return next.lastEventId > prev.lastEventId;
  return next.lastEventAt > prev.lastEventAt;
}

export function deriveActivitySummary(sessions: ActivitySessionViewModel[]): ActivitySummary {
  const needsReviewCount = sessions.filter((s) => s.status === 'needs_review' || s.status === 'plan_ready').length;
  const workingCount = sessions.filter((s) => s.status === 'working').length;
  const issueCount = sessions.filter((s) => s.status === 'issue').length;
  const finishedCount = sessions.filter((s) => s.status === 'finished').length;
  const total = sessions.length;

  if (needsReviewCount > 0) {
    return { total, label: `${needsReviewCount} needs review`, tone: 'warning', needsReviewCount, workingCount, issueCount, finishedCount };
  }
  if (issueCount > 0) {
    return { total, label: issueCount === 1 ? '1 issue' : `${issueCount} issues`, tone: 'danger', needsReviewCount, workingCount, issueCount, finishedCount };
  }
  if (workingCount > 0) {
    return { total, label: `${workingCount} working`, tone: 'info', needsReviewCount, workingCount, issueCount, finishedCount };
  }
  if (finishedCount > 0) {
    return { total, label: `${finishedCount} finished`, tone: 'neutral', needsReviewCount, workingCount, issueCount, finishedCount };
  }
  return { total: 0, label: '', tone: 'neutral', needsReviewCount: 0, workingCount: 0, issueCount: 0, finishedCount: 0 };
}

function shouldShowActivitySession(s: SessionStateSnapshot, activeSessionId: string | null, cached?: ChatState, stored?: StoredSession): boolean {
  if (s.sessionId === activeSessionId) return false;
  if (s.runtimeStatus === 'closed') return false;
  if (s.viewerMode) return false;
  if (s.runtimeStatus === 'idle' && stored) return false;

  const hasUserMessage = !!cached?.items.some((it) => it.kind === 'user' && it.text.trim().length > 0);
  const isEmptyDetachedSession = !s.claudeSessionId && s.lastEventId === 0 && !hasUserMessage;
  if (isEmptyDetachedSession) return false;

  return true;
}

function activityStatus(status: SessionRuntimeStatus): ActivityStatus {
  switch (status) {
    case 'waiting_permission': return 'needs_review';
    case 'waiting_plan': return 'plan_ready';
    case 'running': return 'working';
    case 'error': return 'issue';
    case 'idle':
    case 'closed':
      return 'finished';
  }
}

function activityStatusLabel(status: SessionRuntimeStatus): string {
  switch (status) {
    case 'waiting_permission': return 'Needs approval';
    case 'waiting_plan': return 'Plan ready';
    case 'running': return 'Working';
    case 'error': return 'Issue';
    case 'idle': return 'Finished';
    case 'closed': return 'Finished';
  }
}

function activityTone(status: ActivityStatus): ActivityTone {
  switch (status) {
    case 'needs_review':
    case 'plan_ready':
      return 'warning';
    case 'working':
      return 'info';
    case 'issue':
      return 'danger';
    case 'finished':
      return 'neutral';
  }
}

function activityTitle(s: SessionStateSnapshot, cached: ChatState | undefined, stored: StoredSession | undefined, now: number): string {
  const prompt = firstUserPrompt(cached?.items);
  if (prompt) return trimTitle(prompt);

  const storedTitle = stored?.customTitle ?? stored?.summary ?? stored?.firstPrompt;
  if (storedTitle) return trimTitle(storedTitle);

  return `${compactPath(s.cwd)} · ${formatActivityTime(s.lastEventAt, now)}`;
}

function activitySubtitle(s: SessionStateSnapshot, now: number): string {
  return `${compactPath(s.cwd)} · ${formatActivityTime(s.lastEventAt, now)}`;
}

function firstUserPrompt(items: ChatItem[] | undefined): string | null {
  if (!items) return null;
  const first = items.find((it) => it.kind === 'user' && it.text.trim().length > 0);
  return first?.kind === 'user' ? first.text : null;
}

function trimTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 84 ? `${oneLine.slice(0, 81)}...` : oneLine;
}

function compactPath(path: string): string {
  let s = path;
  if (s.startsWith('/root')) s = '~' + s.slice('/root'.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 3) return s || '/';
  if (s.startsWith('~')) return '~/' + parts.slice(-2).join('/');
  return '/.../' + parts.slice(-2).join('/');
}

function formatActivityTime(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}
