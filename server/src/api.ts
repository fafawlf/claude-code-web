import type { FastifyInstance } from 'fastify';
import { listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { timingSafeEqualStr } from './auth.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', '.cache', '.turbo', '.parcel-cache',
  'coverage', '.DS_Store', '.idea', '.vscode',
]);

export function registerApi(app: FastifyInstance, token: string, defaultCwd: string) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const provided = (req.query as { t?: string } | undefined)?.t ?? '';
    if (!provided || !timingSafeEqualStr(provided, token)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/api/sessions', async (req) => {
    const q = req.query as { cwd?: string; limit?: string } | undefined;
    const sessions = await listSessions({
      dir: q?.cwd ?? defaultCwd,
      limit: q?.limit ? Number(q.limit) : 50,
    });
    return { sessions };
  });

  app.get('/api/info', async () => ({ cwd: defaultCwd, home: homedir() }));

  // Directory browser: returns immediate sub-entries of `path`. No hard root,
  // but the caller is expected to start from $HOME and navigate from there.
  app.get('/api/dirs', async (req, reply) => {
    const q = req.query as { path?: string } | undefined;
    const target = resolveSafe(q?.path ?? homedir());
    try {
      const entries = await readdir(target, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 500);
      const parent = target === '/' ? null : target.split(sep).slice(0, -1).join(sep) || '/';
      return { path: target, parent, dirs };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Fuzzy-ish file search under a cwd. Recursive with skip list; cap 100 results.
  app.get('/api/files', async (req, reply) => {
    const q = req.query as { cwd?: string; q?: string; limit?: string } | undefined;
    const root = resolveSafe(q?.cwd ?? defaultCwd);
    const needle = (q?.q ?? '').toLowerCase();
    const limit = Math.min(Math.max(Number(q?.limit) || 100, 1), 500);
    try {
      const results: string[] = [];
      await walk(root, root, needle, results, limit, 0);
      return { cwd: root, results };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/session/rename', async (req, reply) => {
    const body = req.body as { claudeSessionId?: string; title?: string; cwd?: string } | undefined;
    if (!body?.claudeSessionId || !body?.title) {
      return reply.code(400).send({ error: 'claudeSessionId and title required' });
    }
    try {
      await renameSession(body.claudeSessionId, body.title, body.cwd ? { dir: body.cwd } : undefined);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}

function resolveSafe(p: string): string {
  if (!isAbsolute(p)) return resolve(homedir(), p);
  return resolve(p);
}

const MAX_DEPTH = 6;
const MAX_ENTRIES_PER_DIR = 2000;

async function walk(root: string, dir: string, needle: string, out: string[], limit: number, depth: number): Promise<void> {
  if (out.length >= limit || depth > MAX_DEPTH) return;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  if (entries.length > MAX_ENTRIES_PER_DIR) entries = entries.slice(0, MAX_ENTRIES_PER_DIR);
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    const rel = full.slice(root.length + 1);
    if (e.isDirectory()) {
      await walk(root, full, needle, out, limit, depth + 1);
    } else if (e.isFile()) {
      if (!needle || rel.toLowerCase().includes(needle)) {
        out.push(rel);
      }
    }
  }
}
