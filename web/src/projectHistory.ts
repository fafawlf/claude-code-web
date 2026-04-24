export type ProjectEntry = {
  path: string;
  lastUsed: number;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const RECENTS_KEY = 'ccw_recent_projects';
const PINNED_KEY = 'ccw_pinned_projects';
const MAX_RECENTS = 12;

export function readRecentProjects(storage: StorageLike = window.localStorage): ProjectEntry[] {
  return readJson<ProjectEntry[]>(storage, RECENTS_KEY, [])
    .filter((p) => typeof p.path === 'string' && typeof p.lastUsed === 'number')
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_RECENTS);
}

export function readPinnedProjects(storage: StorageLike = window.localStorage): string[] {
  return readJson<string[]>(storage, PINNED_KEY, []).filter((p) => typeof p === 'string');
}

export function rememberProject(path: string, storage: StorageLike = window.localStorage, now = Date.now()): ProjectEntry[] {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return readRecentProjects(storage);
  const next = [
    { path: normalized, lastUsed: now },
    ...readRecentProjects(storage).filter((p) => p.path !== normalized),
  ].slice(0, MAX_RECENTS);
  storage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

export function togglePinnedProject(path: string, storage: StorageLike = window.localStorage): string[] {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return readPinnedProjects(storage);
  const current = readPinnedProjects(storage);
  const next = current.includes(normalized)
    ? current.filter((p) => p !== normalized)
    : [normalized, ...current];
  storage.setItem(PINNED_KEY, JSON.stringify(next));
  return next;
}

export function normalizeProjectPath(path: string): string {
  return path.trim().replace(/\/+$/, '') || '/';
}

export function projectName(path: string): string {
  const normalized = normalizeProjectPath(path);
  if (normalized === '/') return '/';
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

export function projectParent(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  if (normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return '/' + parts.slice(0, -1).join('/');
}

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
