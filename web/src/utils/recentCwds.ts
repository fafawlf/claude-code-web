// Tracks recently-used project directories in localStorage. Newest first,
// capped at MAX. A project gets bumped to the top each time the user opens it.

const KEY = 'ccw_recent_cwds_v1';
const MAX = 12;

type Entry = { path: string; lastUsed: number };

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is Entry => !!e && typeof e.path === 'string' && typeof e.lastUsed === 'number');
  } catch { return []; }
}

function write(items: Entry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* */ }
}

/** List of recent cwd paths, newest first. */
export function getRecentCwds(): string[] {
  return read().sort((a, b) => b.lastUsed - a.lastUsed).map((e) => e.path);
}

/** Mark `path` as just-used (dedupe & move to top). Keeps the list capped. */
export function recordRecentCwd(path: string): void {
  if (!path) return;
  const entries = read().filter((e) => e.path !== path);
  entries.push({ path, lastUsed: Date.now() });
  entries.sort((a, b) => b.lastUsed - a.lastUsed);
  write(entries.slice(0, MAX));
}

export function clearRecentCwds(): void {
  write([]);
}
