import { getSessionMessages, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { streamBoundedJsonLines } from './boundedJsonl.js';
import { assertSafeTranscriptId } from './transcriptId.js';

export type ClaudeTranscriptMessage = SDKMessage | Record<string, unknown>;

export type ClaudeTranscriptStreamOptions = {
  home?: string;
  searchRoot?: string;
  signal?: AbortSignal;
  onTruncated?: (truncated: boolean) => void;
};

const PATH_CACHE_TTL_MS = 5 * 60_000;
const PATH_CACHE_MAX = 512;
const transcriptPathCache = new Map<string, { path: string; expiresAt: number }>();

/** Stream transcript messages so large JSONL files never become one giant string/array. */
export async function* streamClaudeTranscriptMessages(
  sessionId: string,
  cwd: string,
  options: ClaudeTranscriptStreamOptions = {},
): AsyncGenerator<ClaudeTranscriptMessage> {
  assertSafeTranscriptId(sessionId);
  const home = options.home ?? homedir();
  const file = await findClaudeTranscriptFile(sessionId, cwd, home, options.searchRoot, options.signal);
  if (file) {
    yield* streamClaudeTranscriptFile(file, options.signal, options.onTruncated);
    return;
  }

  throwIfAborted(options.signal);
  const messages = await waitForAbort(
    getSessionMessages(sessionId, { dir: cwd }) as unknown as Promise<ClaudeTranscriptMessage[]>,
    options.signal,
  );
  let yieldedAt = performance.now();
  for (const message of messages) {
    throwIfAborted(options.signal);
    yield message;
    yieldedAt = await yieldIfNeeded(yieldedAt);
  }
}

/** Backward-compatible collecting API for small callers and tests. */
export async function loadClaudeTranscriptMessages(sessionId: string, cwd: string, searchRoot?: string): Promise<ClaudeTranscriptMessage[]> {
  const messages: ClaudeTranscriptMessage[] = [];
  for await (const message of streamClaudeTranscriptMessages(sessionId, cwd, { searchRoot })) messages.push(message);
  return messages;
}

export async function loadClaudeTranscriptFast(sessionId: string, cwd: string, home = homedir(), searchRoot?: string): Promise<ClaudeTranscriptMessage[] | undefined> {
  const file = await findClaudeTranscriptFile(sessionId, cwd, home, searchRoot);
  if (!file) return undefined;
  const messages: ClaudeTranscriptMessage[] = [];
  for await (const message of streamClaudeTranscriptFile(file)) messages.push(message);
  return messages;
}

export async function findClaudeTranscriptFile(
  sessionId: string,
  cwd: string,
  home: string,
  searchRoot?: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  assertSafeTranscriptId(sessionId);
  throwIfAborted(signal);
  const projects = join(home, '.claude', 'projects');
  const direct = join(projects, encodeClaudeProjectPath(cwd), `${sessionId}.jsonl`);
  // When a searchRoot is given (multi-user mode), only transcripts whose
  // recorded cwd lives under that root may be opened — even by exact UUID.
  const allowedPrefix = searchRoot ? encodeClaudeProjectPath(searchRoot) : undefined;
  const cacheKey = [projects, allowedPrefix ?? '', sessionId].join('\0');
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

  try {
    if (!allowedPrefix || isEncodedPathInside(encodeClaudeProjectPath(cwd), allowedPrefix)) {
      await access(direct);
      cacheTranscriptPath(cacheKey, direct);
      throwIfAborted(signal);
      return direct;
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    // Fall through to a one-level search. This keeps old sessions openable even
    // when the stored cwd differs slightly from the currently selected project.
  }

  try {
    const dirs = await readdir(projects, { withFileTypes: true });
    for (const dir of dirs) {
      throwIfAborted(signal);
      if (!dir.isDirectory()) continue;
      if (allowedPrefix && !isEncodedPathInside(dir.name, allowedPrefix)) continue;
      const candidate = join(projects, dir.name, `${sessionId}.jsonl`);
      try {
        await access(candidate);
        cacheTranscriptPath(cacheKey, candidate);
        return candidate;
      } catch (error) {
        if (isAbortError(error)) throw error;
      }
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
  return undefined;
}

async function* streamClaudeTranscriptFile(
  file: string,
  signal?: AbortSignal,
  onTruncated?: (truncated: boolean) => void,
): AsyncGenerator<ClaudeTranscriptMessage> {
  for await (const parsed of streamBoundedJsonLines<Record<string, unknown>>(file, { signal, onTruncated })) {
    if (!isTranscriptMessage(parsed)) continue;
    yield {
      ...parsed,
      parent_tool_use_id: (parsed as { parent_tool_use_id?: unknown }).parent_tool_use_id ?? null,
    } as unknown as SDKMessage;
  }
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

function isEncodedPathInside(encoded: string, encodedRoot: string): boolean {
  return encoded === encodedRoot || encoded.startsWith(`${encodedRoot}-`);
}

export function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function isTranscriptMessage(value: Record<string, unknown>): boolean {
  if ((value.type === 'user' || value.type === 'assistant') && typeof value.message === 'object' && value.message !== null) {
    return true;
  }
  if (value.type === 'attachment' && typeof value.attachment === 'object' && value.attachment !== null) {
    const attachment = value.attachment as Record<string, unknown>;
    return attachment.type === 'plan_mode' && typeof attachment.planFilePath === 'string';
  }
  return false;
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

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
