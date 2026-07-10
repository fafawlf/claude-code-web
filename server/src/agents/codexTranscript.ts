import { access, open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { streamBoundedJsonLines } from '../session/boundedJsonl.js';
import { assertSafeTranscriptId } from '../session/transcriptId.js';

export type CodexTranscriptEvent = Record<string, unknown>;

export type CodexTranscriptOptions = {
  home?: string;
  searchRoot?: string;
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
  const file = await findCodexSessionFile(
    sessionId,
    options.home ?? codexHome(),
    options.signal,
    options.searchRoot,
  );
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
  searchRoot?: string,
): Promise<string | undefined> {
  assertSafeTranscriptId(sessionId);
  throwIfAborted(signal);
  const root = join(home, 'sessions');
  const scope = searchRoot ? resolve(searchRoot) : '';
  const cacheKey = `${root}\0${scope}\0${sessionId}`;
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
      } else if (entry.isFile() && filenameMatchesSession(entry.name, sessionId)) {
        try {
          const metadata = await readSessionMetadata(path, signal);
          if (metadata?.id !== sessionId || !isMetadataInScope(metadata.cwd, scope)) continue;
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

function filenameMatchesSession(filename: string, sessionId: string): boolean {
  return filename === `${sessionId}.jsonl` || filename.endsWith(`-${sessionId}.jsonl`);
}

type CodexSessionMetadata = { id?: string; cwd?: string };

async function readSessionMetadata(path: string, signal?: AbortSignal): Promise<CodexSessionMetadata | undefined> {
  throwIfAborted(signal);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    throwIfAborted(signal);
    for (const line of buffer.toString('utf8', 0, bytesRead).split('\n')) {
      if (!line.includes('"session_meta"')) continue;
      try {
        const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
        if (parsed.type !== 'session_meta' || typeof parsed.payload !== 'object' || parsed.payload === null) continue;
        const payload = parsed.payload as Record<string, unknown>;
        return {
          id: typeof payload.id === 'string' ? payload.id : undefined,
          cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
        };
      } catch {
        // Keep scanning: malformed unrelated lines must not make a candidate
        // eligible, and a later valid session_meta can still identify it.
      }
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

function isMetadataInScope(cwd: string | undefined, scope: string): boolean {
  if (!scope) return true;
  if (!cwd || !isAbsolute(cwd)) return false;
  const candidate = resolve(cwd);
  const rel = relative(scope, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
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
