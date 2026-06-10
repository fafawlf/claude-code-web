import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeClaudeProjectPath } from '../session/claudeTranscript.js';

const CACHE_MS = 60_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type PerUserUsage = {
  slug: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
  sessions: number;
};

let cache: { key: string; value: PerUserUsage[]; at: number } | undefined;

/**
 * Aggregate the last 7 days of token usage per user by scanning the Claude
 * Code transcripts written for projects under each user's workspace. This is
 * an estimate for transparency, not billing.
 */
export async function getPerUserUsage(
  usersRoot: string,
  slugs: string[],
  opts: { projectsDir?: string; now?: number } = {}
): Promise<PerUserUsage[]> {
  const key = `${usersRoot}|${slugs.sort().join(',')}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;

  const projectsDir = opts.projectsDir ?? join(homedir(), '.claude', 'projects');
  const now = opts.now ?? Date.now();
  const totals = new Map<string, PerUserUsage>();
  for (const slug of slugs) {
    totals.set(slug, { slug, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreate: 0, sessions: 0 });
  }

  let dirs: string[] = [];
  try {
    dirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    const value = [...totals.values()];
    cache = { key, value, at: Date.now() };
    return value;
  }

  // Longest-prefix match so slug "li" never swallows "li-wang"'s projects.
  const prefixes = slugs
    .map((slug) => ({ slug, prefix: encodeClaudeProjectPath(join(usersRoot, slug)) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const dir of dirs) {
    const match = prefixes.find((p) => dir === p.prefix || dir.startsWith(`${p.prefix}-`));
    if (!match) continue;
    const bucket = totals.get(match.slug)!;
    const dirPath = join(projectsDir, dir);
    let files: string[] = [];
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dirPath, file);
      try {
        const st = await stat(path);
        if (now - st.mtimeMs > WINDOW_MS) continue;
        bucket.sessions += 1;
        accumulateTranscript(await readFile(path, 'utf8'), bucket);
      } catch {
        // Skip unreadable transcripts.
      }
    }
  }

  const value = [...totals.values()].sort((a, b) => b.tokensOut - a.tokensOut);
  cache = { key, value, at: Date.now() };
  return value;
}

export function clearPerUserUsageCache(): void {
  cache = undefined;
}

function accumulateTranscript(raw: string, bucket: PerUserUsage): void {
  for (const line of raw.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { usage?: Record<string, unknown> };
      };
      if (parsed.type !== 'assistant') continue;
      const usage = parsed.message?.usage;
      if (!usage) continue;
      bucket.tokensIn += num(usage.input_tokens);
      bucket.tokensOut += num(usage.output_tokens);
      bucket.cacheRead += num(usage.cache_read_input_tokens);
      bucket.cacheCreate += num(usage.cache_creation_input_tokens);
    } catch {
      // Partial line mid-write; skip.
    }
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
