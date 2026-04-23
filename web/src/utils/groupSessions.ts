import type { StoredSession } from '../types';

export type SessionGroup = { label: string; items: StoredSession[] };

const DAY = 24 * 60 * 60 * 1000;

/** Group sessions by relative-date buckets. Expects items sorted newest first. */
export function groupSessions(items: StoredSession[]): SessionGroup[] {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday.getTime() - DAY;
  const startOfWeek = startOfToday.getTime() - 6 * DAY;

  const today: StoredSession[] = [];
  const yesterday: StoredSession[] = [];
  const thisWeek: StoredSession[] = [];
  const earlier: StoredSession[] = [];

  for (const s of items) {
    const t = s.lastModified;
    if (t >= startOfToday.getTime()) today.push(s);
    else if (t >= startOfYesterday) yesterday.push(s);
    else if (t >= startOfWeek) thisWeek.push(s);
    else earlier.push(s);
  }

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'This week', items: thisWeek },
    { label: 'Earlier', items: earlier },
  ].filter((g) => g.items.length > 0);
  // Suppress unused warning if `now` gets optimized out
  void now;
}
