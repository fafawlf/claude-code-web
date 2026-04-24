import type { FastifyInstance } from 'fastify';
import { listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { arch, homedir, platform } from 'node:os';
import { timingSafeEqualStr } from './auth.js';
import { detectClaudeAuthInfo } from './authInfo.js';
import type { SessionManager } from './session/SessionManager.js';
import { detectClaudeExecutable } from './session/resolveClaudePath.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', '.cache', '.turbo', '.parcel-cache',
  'coverage', '.DS_Store', '.idea', '.vscode',
]);

const MAX_UPLOAD_FILES = 12;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 80 * 1024 * 1024;

export function registerApi(
  app: FastifyInstance,
  token: string,
  defaultCwd: string,
  sm: SessionManager,
  runtime: { host?: string; port?: number } = {}
) {
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

  app.get('/api/info', async () => ({
    cwd: defaultCwd,
    home: homedir(),
    auth: detectClaudeAuthInfo(),
    claude: detectClaudeExecutable(),
    server: {
      host: runtime.host ?? '127.0.0.1',
      port: runtime.port,
      platform: platform(),
      arch: arch(),
      node: process.version,
    },
  }));

  app.get('/api/live-sessions', async () => ({ sessions: sm.listSnapshots() }));

  // Directory browser: returns immediate sub-entries of `path`. For each dir
  // we also probe for a `.git` so the picker can show a small repo marker.
  // Hidden dirs (leading dot) are skipped. No hard root — the caller is
  // expected to start from $HOME and navigate from there.
  app.get('/api/dirs', async (req, reply) => {
    const q = req.query as { path?: string } | undefined;
    const target = resolveSafe(q?.path ?? homedir());
    try {
      const entries = await readdir(target, { withFileTypes: true });
      const names = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 500);

      // Parallel stat for .git — trivial on local FS; bounded by the 500 cap.
      const enriched = await Promise.all(
        names.map(async (name) => {
          let hasGit = false;
          try { await stat(join(target, name, '.git')); hasGit = true; } catch { /* */ }
          return { name, hasGit };
        })
      );

      const parent = target === '/' ? null : target.split(sep).slice(0, -1).join(sep) || '/';
      // Also detect whether the target itself is a git repo (useful for "use
      // this folder" hinting at the top of the picker).
      let targetHasGit = false;
      try { await stat(join(target, '.git')); targetHasGit = true; } catch { /* */ }

      // Keep `dirs` for backward compatibility with older clients.
      return { path: target, parent, targetHasGit, entries: enriched, dirs: names };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/dirs', async (req, reply) => {
    const body = req.body as { parentPath?: string; name?: string } | undefined;
    const parent = resolveSafe(body?.parentPath ?? homedir());
    const name = validateFolderName(body?.name);
    if (!name.ok) return reply.code(400).send({ error: name.error });

    const target = join(parent, name.value);
    try {
      await mkdir(target);
      return { path: target };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/uploads', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const body = req.body as UploadRequest | undefined;
    const root = resolveSafe(body?.cwd ?? defaultCwd);
    const files = body?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return reply.code(400).send({ error: 'files required' });
    }
    if (files.length > MAX_UPLOAD_FILES) {
      return reply.code(400).send({ error: `Upload at most ${MAX_UPLOAD_FILES} files at once` });
    }

    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) return reply.code(400).send({ error: 'cwd is not a directory' });
      const uploadDir = join(root, '.claudecode-web', 'uploads', new Date().toISOString().slice(0, 10));
      await mkdir(uploadDir, { recursive: true });

      const saved = [];
      for (const file of files) {
        const name = sanitizeFileName(file?.name);
        const bytes = decodeUploadBytes(file?.dataBase64);
        if (bytes.byteLength === 0) return reply.code(400).send({ error: `${name} is empty` });
        if (bytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
          return reply.code(400).send({ error: `${name} is larger than 25 MB` });
        }
        const path = await writeUniqueFile(uploadDir, name, bytes);
        const rel = relative(root, path);
        saved.push({
          name: basename(path),
          path,
          relativePath: rel.startsWith('..') ? path : rel,
          mime: typeof file?.mime === 'string' ? file.mime : undefined,
          size: bytes.byteLength,
        });
      }
      return { files: saved };
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

  app.get('/api/file', async (req, reply) => {
    const q = req.query as { cwd?: string; path?: string; download?: string } | undefined;
    if (!q?.path) return reply.code(400).send({ error: 'path required' });
    try {
      const target = resolveProjectFile(q.cwd ?? defaultCwd, q.path);
      const st = await stat(target);
      if (!st.isFile()) return reply.code(400).send({ error: 'path is not a file' });
      const filename = basename(target);
      reply
        .header('content-type', mimeForFile(target))
        .header('content-length', st.size)
        .header('content-disposition', `${q.download === '1' ? 'attachment' : 'inline'}; filename="${headerSafeFilename(filename)}"`);
      return reply.send(createReadStream(target));
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

  app.post('/api/session/close', async (req, reply) => {
    const body = req.body as { sessionId?: string } | undefined;
    if (!body?.sessionId) return reply.code(400).send({ error: 'sessionId required' });
    await sm.remove(body.sessionId);
    return { ok: true };
  });
}

function resolveSafe(p: string): string {
  if (!isAbsolute(p)) return resolve(homedir(), p);
  return resolve(p);
}

function resolveProjectFile(cwd: string, filePath: string): string {
  const root = resolveSafe(cwd);
  const raw = filePath.trim().replace(/^@/, '');
  const target = raw.startsWith('~/')
    ? resolve(homedir(), raw.slice(2))
    : isAbsolute(raw)
      ? resolve(raw)
      : resolve(root, raw);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('File is outside the current project');
  }
  return target;
}

function validateFolderName(name: string | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const value = (name ?? '').trim();
  if (!value) return { ok: false, error: 'Folder name required' };
  if (value === '.' || value === '..') return { ok: false, error: 'Folder name cannot be . or ..' };
  if (value.includes('/') || value.includes('\0')) return { ok: false, error: 'Folder name cannot contain /' };
  if (value.length > 128) return { ok: false, error: 'Folder name is too long' };
  return { ok: true, value };
}

type UploadRequest = {
  cwd?: string;
  files?: Array<{ name?: string; mime?: string; dataBase64?: string }>;
};

function sanitizeFileName(name: string | undefined): string {
  const raw = basename((name || 'upload').replace(/\\/g, '/'));
  let clean = raw.replace(/[\0-\x1f<>:"|?*]/g, '-').replace(/\s+/g, ' ').trim();
  if (!clean || clean === '.' || clean === '..') clean = 'upload';
  if (clean.length > 128) {
    const ext = extname(clean).slice(0, 20);
    clean = clean.slice(0, 128 - ext.length) + ext;
  }
  return clean;
}

function decodeUploadBytes(dataBase64: string | undefined): Buffer {
  if (!dataBase64 || typeof dataBase64 !== 'string') throw new Error('dataBase64 required');
  const raw = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  return Buffer.from(raw, 'base64');
}

async function writeUniqueFile(dir: string, name: string, bytes: Buffer): Promise<string> {
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? name : `${base}-${i + 1}${ext}`;
    const path = join(dir, candidate);
    try {
      await writeFile(path, bytes, { flag: 'wx' });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error(`Could not find a free filename for ${name}`);
}

function mimeForFile(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.txt':
    case '.md':
    case '.log':
      return 'text/plain; charset=utf-8';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

function headerSafeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_');
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
