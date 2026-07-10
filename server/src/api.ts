import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyMultipart, { type MultipartFile } from '@fastify/multipart';
import { listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, stat, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { arch, homedir, platform } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { detectClaudeAuthInfo, detectCodexAuthInfo } from './authInfo.js';
import type { SessionManager } from './session/SessionManager.js';
import { detectClaudeExecutable } from './session/resolveClaudePath.js';
import { detectCodexExecutable } from './agents/resolveCodexPath.js';
import { NodeRegistry, type NodeConfig, type PublicNode } from './nodes/NodeRegistry.js';
import { tokenModeConfig, type CcwConfig } from './config.js';
import { resolveUser, fsAnchor, assertInScope, isPathInside, resolveScoped, ScopeError, type CcwUser, type IdentityContext } from './users/identity.js';
import type { UserRegistry } from './users/registry.js';
import { findClaudeTranscriptFile } from './session/claudeTranscript.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', '.cache', '.turbo', '.parcel-cache',
  'coverage', '.DS_Store', '.idea', '.vscode',
]);

const MAX_UPLOAD_FILES = 12;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 50 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 80 * 1024 * 1024;
const FILE_SEARCH_TIME_BUDGET_MS = 200;
const FILE_SEARCH_ENTRY_BUDGET = 20_000;
const DOWNLOADABLE_OUTSIDE_PROJECT_EXTENSIONS = new Set([
  '.csv', '.doc', '.docx', '.gif', '.html', '.jpeg', '.jpg', '.json', '.log', '.md',
  '.pdf', '.png', '.ppt', '.pptx', '.svg', '.txt', '.webp', '.xls', '.xlsx', '.zip',
]);

export type IdentityOptions = {
  config: CcwConfig;
  registry?: UserRegistry;
};

type RequestWithUser = FastifyRequest & { ccwUser?: CcwUser };

export function userOf(req: FastifyRequest): CcwUser {
  const user = (req as RequestWithUser).ccwUser;
  if (!user) throw new Error('request user not resolved');
  return user;
}

export function registerApi(
  app: FastifyInstance,
  token: string,
  defaultCwd: string,
  sm: SessionManager,
  nodes: NodeRegistry = new NodeRegistry(defaultCwd),
  runtime: { host?: string; port?: number } = {},
  identity: IdentityOptions = { config: tokenModeConfig() }
) {
  app.register(fastifyMultipart, {
    limits: {
      fields: 4,
      files: MAX_UPLOAD_FILES,
      fileSize: MAX_UPLOAD_FILE_BYTES,
      parts: MAX_UPLOAD_FILES + 4,
    },
  });

  const idCtx: IdentityContext = {
    token,
    defaultCwd,
    config: identity.config,
    registry: identity.registry,
  };

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const user = resolveUser(req, idCtx);
    if (!user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    (req as RequestWithUser).ccwUser = user;
  });

  // Visible server internals differ by trust level: legacy token auth keeps
  // the full single-user response; feishu users get a view scoped to their
  // workspace with no bind address or absolute executable paths.
  const infoFor = (user: CcwUser, node?: NodeConfig | PublicNode) => {
    const full = user.via === 'token';
    return {
      cwd: full ? defaultCwd : user.workspaceRoot,
      home: fsAnchor(user),
      node: node ? scrubNode(node, user) : undefined,
      auth: detectClaudeAuthInfo(),
      codexAuth: detectCodexAuthInfo(),
      claude: scrubExecutable(detectClaudeExecutable(), full),
      codex: scrubExecutable(detectCodexExecutable(), full),
      server: {
        ...(full ? { host: runtime.host ?? '127.0.0.1', port: runtime.port } : {}),
        platform: platform(),
        arch: arch(),
        node: process.version,
      },
    };
  };

  app.get('/api/me', async (req) => {
    const user = userOf(req);
    return {
      authMode: identity.config.authMode,
      user: {
        name: user.name,
        email: user.email,
        slug: user.slug,
        role: user.role,
        avatarUrl: user.avatarUrl,
        workspaceRoot: user.workspaceRoot,
      },
    };
  });

  app.get('/api/sessions', async (req, reply) => {
    const user = userOf(req);
    const q = req.query as { cwd?: string; limit?: string } | undefined;
    try {
      const sessions = await listSessions({
        dir: resolveSafe(q?.cwd ?? user.workspaceRoot, user),
        limit: q?.limit ? Number(q.limit) : 50,
      });
      return { sessions };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.get('/api/info', async (req) => infoFor(userOf(req), nodes.get('local')));

  app.get('/api/nodes', async (req) => {
    const user = userOf(req);
    return { nodes: nodes.list().map((n) => scrubNode(n, user)) };
  });

  app.get('/api/node/info', async (req, reply) => {
    const q = req.query as { nodeId?: string } | undefined;
    const node = nodes.get(q?.nodeId);
    if (!node) return reply.code(404).send({ error: 'Node not found' });
    if (node.kind !== 'local') return reply.code(501).send({ error: 'SSH nodes are not wired yet' });
    return infoFor(userOf(req), node);
  });

  app.get('/api/live-sessions', async (req) => {
    const user = userOf(req);
    const sessions = user.via === 'token' || user.isAdmin
      ? sm.listSnapshots()
      : sm.listSnapshotsForOwner(user.openId);
    return { sessions };
  });

  // Directory browser: returns immediate sub-entries of `path`. For each dir
  // we also probe for a `.git` so the picker can show a small repo marker.
  // Hidden dirs (leading dot) are skipped. No hard root — the caller is
  // expected to start from $HOME and navigate from there.
  app.get('/api/dirs', async (req, reply) => {
    const user = userOf(req);
    const q = req.query as { path?: string } | undefined;
    try {
      const target = resolveSafe(q?.path ?? fsAnchor(user), user);
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

      const atScopeRoot = user.fsRoot !== '' && target === resolve(user.fsRoot);
      const parent = target === '/' || atScopeRoot ? null : target.split(sep).slice(0, -1).join(sep) || '/';
      // Also detect whether the target itself is a git repo (useful for "use
      // this folder" hinting at the top of the picker).
      let targetHasGit = false;
      try { await stat(join(target, '.git')); targetHasGit = true; } catch { /* */ }

      // Keep `dirs` for backward compatibility with older clients.
      return { path: target, parent, targetHasGit, entries: enriched, dirs: names };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.post('/api/dirs', async (req, reply) => {
    const user = userOf(req);
    const body = req.body as { parentPath?: string; name?: string } | undefined;
    const name = validateFolderName(body?.name);
    if (!name.ok) return reply.code(400).send({ error: name.error });

    try {
      const parent = resolveSafe(body?.parentPath ?? fsAnchor(user), user);
      const target = join(parent, name.value);
      await mkdir(target);
      return { path: target };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.post('/api/uploads', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const user = userOf(req);
    if (req.isMultipart()) {
      return receiveMultipartUploads(req, reply, user);
    }
    const body = req.body as UploadRequest | undefined;
    let root: string;
    try {
      root = resolveSafe(body?.cwd ?? user.workspaceRoot, user);
    } catch (e) {
      return sendScoped(reply, e);
    }
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
      let totalBytes = 0;
      for (const file of files) {
        const name = sanitizeFileName(file?.name);
        const bytes = decodeUploadBytes(file?.dataBase64);
        if (bytes.byteLength === 0) return reply.code(400).send({ error: `${name} is empty` });
        if (bytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
          return reply.code(400).send({ error: `${name} is larger than 25 MB` });
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
          return reply.code(400).send({ error: 'Uploads are larger than the 50 MB total limit' });
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
    const user = userOf(req);
    const q = req.query as { cwd?: string; q?: string; limit?: string } | undefined;
    const needle = (q?.q ?? '').toLowerCase();
    const limit = Math.min(Math.max(Number(q?.limit) || 100, 1), 500);
    try {
      const root = resolveSafe(q?.cwd ?? user.workspaceRoot, user);
      const { results, truncated } = await searchProjectFiles(root, needle, limit);
      return { cwd: root, results, truncated };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.get('/api/file', async (req, reply) => {
    const user = userOf(req);
    const q = req.query as { cwd?: string; path?: string; download?: string } | undefined;
    if (!q?.path) return reply.code(400).send({ error: 'path required' });
    try {
      const target = resolveProjectFile(q.cwd ?? user.workspaceRoot, q.path, user, defaultCwd);
      const st = await stat(target);
      if (!st.isFile()) return reply.code(400).send({ error: 'path is not a file' });
      const filename = basename(target);
      reply
        .header('content-type', mimeForFile(target))
        .header('content-length', st.size)
        .header('content-disposition', `${q.download === '1' ? 'attachment' : 'inline'}; filename="${headerSafeFilename(filename)}"`);
      return reply.send(createReadStream(target));
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.post('/api/session/rename', async (req, reply) => {
    const user = userOf(req);
    const body = req.body as { claudeSessionId?: string; title?: string; cwd?: string } | undefined;
    if (!body?.claudeSessionId || !body?.title) {
      return reply.code(400).send({ error: 'claudeSessionId and title required' });
    }
    try {
      const cwd = body.cwd ? resolveSafe(body.cwd, user) : undefined;
      if (user.fsRoot) {
        // Renames only apply to transcripts that live under this user's scope.
        const file = await findClaudeTranscriptFile(
          body.claudeSessionId,
          cwd ?? user.workspaceRoot,
          homedir(),
          user.fsRoot
        );
        if (!file) return reply.code(403).send({ error: 'Session is not in your workspace' });
      }
      await renameSession(body.claudeSessionId, body.title, cwd ? { dir: cwd } : undefined);
      return { ok: true };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.post('/api/session/close', async (req, reply) => {
    const user = userOf(req);
    const body = req.body as { sessionId?: string } | undefined;
    if (!body?.sessionId) return reply.code(400).send({ error: 'sessionId required' });
    if (user.via === 'cookie' && !user.isAdmin && sm.ownerOf(body.sessionId) !== user.openId) {
      return reply.code(403).send({ error: 'Not your session' });
    }
    await sm.remove(body.sessionId);
    return { ok: true };
  });
}

function sendScoped(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) {
  const status = e instanceof ScopeError ? 403 : 400;
  return reply.code(status).send({ error: (e as Error).message });
}

const resolveSafe = resolveScoped;

function scrubNode<T extends NodeConfig | PublicNode>(node: T, user: CcwUser): T {
  if (user.via === 'token') return node;
  const { ssh: _ssh, ...rest } = node as NodeConfig;
  return { ...rest, defaultCwd: user.workspaceRoot } as T;
}

function scrubExecutable<T extends { path?: string }>(info: T, full: boolean): T {
  if (full) return info;
  return { ...info, path: undefined };
}

function resolveProjectFile(cwd: string, filePath: string, user: CcwUser, defaultCwd: string): string {
  const root = resolveSafe(cwd, user);
  const raw = filePath.trim().replace(/^@/, '');
  const target = raw.startsWith('~/')
    ? resolve(fsAnchor(user), raw.slice(2))
    : isAbsolute(raw)
      ? resolve(raw)
      : resolve(root, raw);
  const rel = relative(root, target);
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
    assertInScope(user, target);
    return target;
  }

  // Relative paths must stay in the current project. Absolute paths printed by
  // Claude often point at another project under the same server home/workspace,
  // so allow common generated artifacts there without turning /api/file into a
  // general filesystem browser.
  if (!isAbsolute(raw) && !raw.startsWith('~/')) {
    throw new Error('File is outside the current project');
  }
  if (!DOWNLOADABLE_OUTSIDE_PROJECT_EXTENSIONS.has(extname(target).toLowerCase())) {
    throw new Error('File is outside the current project');
  }
  if (user.fsRoot) {
    assertInScope(user, target);
    return target;
  }
  const roots = [resolveSafe(defaultCwd, user), homedir()]
    .map((p) => resolve(p))
    .filter((p, i, arr) => arr.indexOf(p) === i);
  if (!roots.some((allowedRoot) => isPathInside(allowedRoot, target))) {
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

type UploadReply = {
  code: (status: number) => { send: (body: unknown) => unknown };
};

async function receiveMultipartUploads(
  req: FastifyRequest,
  reply: UploadReply,
  user: CcwUser,
): Promise<unknown> {
  const q = req.query as { cwd?: string } | undefined;
  let root: string;
  try {
    root = resolveSafe(q?.cwd ?? user.workspaceRoot, user);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return reply.code(400).send({ error: 'cwd is not a directory' });
  } catch (e) {
    return sendScoped(reply, e);
  }

  const uploadDir = join(root, '.claudecode-web', 'uploads', new Date().toISOString().slice(0, 10));
  const savedPaths: string[] = [];
  const saved: Array<{ name: string; path: string; relativePath: string; mime?: string; size: number }> = [];
  const total = { bytes: 0 };

  try {
    await mkdir(uploadDir, { recursive: true });
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const name = sanitizeFileName(part.filename);
      const written = await writeUniqueUploadStream(uploadDir, name, part, total);
      savedPaths.push(written.path);
      const rel = relative(root, written.path);
      saved.push({
        name: basename(written.path),
        path: written.path,
        relativePath: rel.startsWith('..') ? written.path : rel,
        mime: part.mimetype || undefined,
        size: written.size,
      });
    }
    if (saved.length === 0) return reply.code(400).send({ error: 'files required' });
    return { files: saved };
  } catch (e) {
    await Promise.all(savedPaths.map((path) => unlink(path).catch(() => undefined)));
    const message = uploadErrorMessage(e);
    return reply.code(400).send({ error: message });
  }
}

async function writeUniqueUploadStream(
  dir: string,
  name: string,
  part: MultipartFile,
  total: { bytes: number },
): Promise<{ path: string; size: number }> {
  const reserved = await reserveUniqueFile(dir, name);
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      total.bytes += chunk.byteLength;
      if (total.bytes > MAX_UPLOAD_TOTAL_BYTES) {
        callback(new Error('Uploads are larger than the 50 MB total limit'));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(part.file, counter, reserved.handle.createWriteStream());
    if (part.file.truncated) throw new Error(`${name} is larger than 25 MB`);
    if (size === 0) throw new Error(`${name} is empty`);
    return { path: reserved.path, size };
  } catch (e) {
    await reserved.handle.close().catch(() => undefined);
    await unlink(reserved.path).catch(() => undefined);
    throw e;
  }
}

async function reserveUniqueFile(dir: string, name: string): Promise<{ path: string; handle: FileHandle }> {
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? name : `${base}-${i + 1}${ext}`;
    const path = join(dir, candidate);
    try {
      return { path, handle: await open(path, 'wx') };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error(`Could not find a free filename for ${name}`);
}

function uploadErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') return 'A file is larger than 25 MB';
  if (code === 'FST_FILES_LIMIT') return `Upload at most ${MAX_UPLOAD_FILES} files at once`;
  return String((e as Error)?.message || e || 'Upload failed');
}

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

type FileSearchOptions = {
  timeBudgetMs?: number;
  entryBudget?: number;
  now?: () => number;
};

type FileSearchContext = {
  deadline: number;
  entryBudget: number;
  visited: number;
  truncated: boolean;
  now: () => number;
};

export async function searchProjectFiles(
  root: string,
  needle: string,
  limit: number,
  options: FileSearchOptions = {},
): Promise<{ results: string[]; truncated: boolean }> {
  const now = options.now ?? Date.now;
  const context: FileSearchContext = {
    deadline: now() + (options.timeBudgetMs ?? FILE_SEARCH_TIME_BUDGET_MS),
    entryBudget: options.entryBudget ?? FILE_SEARCH_ENTRY_BUDGET,
    visited: 0,
    truncated: false,
    now,
  };
  const results: string[] = [];
  await walk(root, root, needle.toLowerCase(), results, limit, 0, context);
  return { results, truncated: context.truncated };
}

async function walk(root: string, dir: string, needle: string, out: string[], limit: number, depth: number, context: FileSearchContext): Promise<void> {
  if (out.length >= limit || depth > MAX_DEPTH) return;
  if (context.visited >= context.entryBudget || context.now() > context.deadline) {
    context.truncated = true;
    return;
  }
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  if (entries.length > MAX_ENTRIES_PER_DIR) {
    entries = entries.slice(0, MAX_ENTRIES_PER_DIR);
    context.truncated = true;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    context.visited += 1;
    if (context.visited > context.entryBudget || context.now() > context.deadline) {
      context.truncated = true;
      return;
    }
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    const rel = full.slice(root.length + 1);
    if (e.isDirectory()) {
      await walk(root, full, needle, out, limit, depth + 1, context);
    } else if (e.isFile()) {
      if (!needle || rel.toLowerCase().includes(needle)) {
        out.push(rel);
      }
    }
  }
}
