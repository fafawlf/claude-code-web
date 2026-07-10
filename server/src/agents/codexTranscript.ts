import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { streamBoundedJsonLines } from '../session/boundedJsonl.js';

export type CodexTranscriptEvent = Record<string, unknown>;

export type CodexTranscriptOptions = {
  home?: string;
  signal?: AbortSignal;
  onTruncated?: (truncated: boolean) => void;
};

const PATH_CACHE_TTL_MS = 5 * 60_000;
const PATH_CACHE_MAX = 512;
const transcriptPathCache = new Map<string, { path: string; expiresAt: number }>();

export async function* streamCodexTranscriptEvents(
  sessionId: string,
  options: CodexTranscriptOptions = {},
): AsyncGenerator<CodexTranscriptEvent> {
  const file = await findCodexSessionFile(sessionId, options.home ?? codexHome(), options.signal);
  if (!file) return;
  yield* streamBoundedJsonLines<CodexTranscriptEvent>(file, {
    signal: options.signal,
    onTruncated: options.onTruncated,
    // session_meta carries the model/thread identity and normally appears at
    // the start of a rollout, before a large tail that may be evicted.
    pinLine: (line) => line.includes('"session_meta"'),
  });
}

export async function findCodexSessionFile(
  sessionId: string,
  home = codexHome(),
  signal?: AbortSignal,
): Promise<string | undefined> {
  throwIfAborted(signal);
  const root = join(home, 'sessions');
  const cacheKey = `${root}\0${sessionId}`;
  const cached = transcriptPathCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      await access(cached.path);
      throwIfAborted(signal);
      return cached.path;
    } catch (error) {
      transcriptPathCache.delete(cacheKey);
      if (isAbortError(error)) throw error;
    }
  }

  let best: { path: string; mtime: number } | undefined;
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let yieldedAt = performance.now();
  while (pending.length > 0) {
    throwIfAborted(signal);
    const current = pending.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch (error) {
      if (isAbortError(error)) throw error;
      continue;
    }
    for (const entry of entries) {
      throwIfAborted(signal);
      const path = join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 5) {
        pending.push({ dir: path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && basename(entry.name).includes(sessionId)) {
        try {
          const info = await stat(path);
          if (!best || info.mtimeMs >= best.mtime) best = { path, mtime: info.mtimeMs };
        } catch (error) {
          if (isAbortError(error)) throw error;
        }
      }
      yieldedAt = await yieldIfNeeded(yieldedAt);
    }
  }

  if (best) cacheTranscriptPath(cacheKey, best.path);
  return best?.path;
}

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function cacheTranscriptPath(key: string, path: string): void {
  transcriptPathCache.delete(key);
  transcriptPathCache.set(key, { path, expiresAt: Date.now() + PATH_CACHE_TTL_MS });
  while (transcriptPathCache.size > PATH_CACHE_MAX) {
    const oldest = transcriptPathCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    transcriptPathCache.delete(oldest);
  }
}

async function yieldIfNeeded(lastYield: number): Promise<number> {
  if (performance.now() - lastYield < 8) return lastYield;
  await new Promise<void>((resolve) => setImmediate(resolve));
  return performance.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
