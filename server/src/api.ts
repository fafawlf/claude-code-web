import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyMultipart, { type MultipartFile } from '@fastify/multipart';
import { listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, open, readdir, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { arch, homedir, platform } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { detectClaudeAuthInfo, detectCodexAuthInfo } from './authInfo.js';
import type { SessionManager } from './session/SessionManager.js';
import { detectClaudeExecutable } from './session/resolveClaudePath.js';
import { detectCodexExecutable } from './agents/resolveCodexPath.js';
import { NodeRegistry, type NodeConfig, type PublicNode } from './nodes/NodeRegistry.js';
import { tokenModeConfig, type CcwConfig } from './config.js';
import { createIdentityContext, resolveUser, fsAnchor, assertInScope, isPathInside, openScopedDirectory, openScopedFile, resolveScoped, ScopeError, type CcwUser, type IdentityContext, type ScopedOpenFile } from './users/identity.js';
import type { UserRegistry } from './users/registry.js';
import { findClaudeTranscriptFile } from './session/claudeTranscript.js';
import { timingSafeEqualStr } from './auth.js';
import { serializeCookie } from './auth/cookie.js';
import {
  assertSafeUploadDirectory,
  ensureSafeUploadDirectory,
  openSafeUploadDirectory,
  UploadAdmissionController,
  type SafeUploadDirectoryHandle,
  type UploadLease,
} from './uploadSecurity.js';

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
  context?: IdentityContext;
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
  runtime: { host?: string; port?: number; uploadAdmission?: UploadAdmissionController } = {},
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

  const idCtx = identity.context ?? createIdentityContext({
    token,
    defaultCwd,
    config: identity.config,
    registry: identity.registry,
  });
  const uploadAdmission = runtime.uploadAdmission ?? new UploadAdmissionController({
    maxFiles: MAX_UPLOAD_FILES,
    maxBytes: MAX_UPLOAD_TOTAL_BYTES,
  });

  app.get('/__ccw_canary', async (req, reply) => {
    const tokens = [process.env.CCW_CANARY_TOKEN, process.env.CCW_ROLLBACK_TOKEN]
      .filter((value): value is string => !!value);
    const query = req.query as { key?: string } | undefined;
    const token = query?.key
      ? tokens.find((candidate) => timingSafeEqualStr(query.key!, candidate))
      : undefined;
    if (!token) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const user = resolveUser(req, idCtx);
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    if (!user.isAdmin) return reply.code(403).send({ error: 'Admin required' });
    reply.header('set-cookie', serializeCookie('ccw_canary', token, {
      maxAge: 4 * 60 * 60,
      secure: identity.config.cookieSecure,
    }));
    return reply.redirect('/');
  });

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

  // Nginx uses this internal-only authorization subrequest before setting a
  // canary cookie. The cookie route itself is unreachable to regular members.
  app.get('/api/admin/canary-check', async (req, reply) => {
    const user = userOf(req);
    if (!user.isAdmin) return reply.code(403).send({ error: 'Admin required' });
    return reply.code(204).send();
  });

  app.post('/api/client-errors', async (req, reply) => {
    const user = userOf(req);
    const body = req.body as Partial<{
      kind: string;
      message: string;
      source: string;
      line: number;
      column: number;
    }> | undefined;
    const message = cleanTelemetryText(body?.message, 500);
    if (!message) return reply.code(400).send({ error: 'message required' });
    req.log.warn({
      event: 'client_error',
      userId: user.openId,
      kind: cleanTelemetryText(body?.kind, 32) || 'error',
      message,
      source: cleanTelemetryText(body?.source, 160) || undefined,
      line: safeTelemetryCoordinate(body?.line),
      column: safeTelemetryCoordinate(body?.column),
    }, 'browser error');
    return reply.code(204).send();
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
      const directory = await openScopedDirectory(user, target);
      try {
        const entries = await readdir(directory.accessPath, { withFileTypes: true });
        const names = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, 500);

        // Keep the opened directory pinned while probing children. On Linux
        // accessPath is /proc/self/fd/N, so a concurrent symlink swap cannot
        // redirect these reads outside the validated workspace.
        const enriched = await Promise.all(
          names.map(async (name) => {
            let hasGit = false;
            try { await stat(join(directory.accessPath, name, '.git')); hasGit = true; } catch { /* */ }
            return { name, hasGit };
          })
        );

        const atScopeRoot = user.fsRoot !== '' && target === resolve(user.fsRoot);
        const parent = target === '/' || atScopeRoot ? null : target.split(sep).slice(0, -1).join(sep) || '/';
        let targetHasGit = false;
        try { await stat(join(directory.accessPath, '.git')); targetHasGit = true; } catch { /* */ }

        return { path: target, parent, targetHasGit, entries: enriched, dirs: names };
      } finally {
        await directory.close().catch(() => undefined);
      }
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
      // Validate the not-yet-existing child against the nearest real ancestor,
      // then create it relative to a pinned parent directory on Linux.
      resolveSafe(target, user);
      const directory = await openScopedDirectory(user, parent);
      try {
        await mkdir(join(directory.accessPath, name.value));
      } finally {
        await directory.close().catch(() => undefined);
      }
      const created = await openScopedDirectory(user, target);
      await created.close().catch(() => undefined);
      return { path: target };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.post('/api/uploads', {
    bodyLimit: UPLOAD_BODY_LIMIT,
    // Production Feishu clients use the streaming multipart transport. Reject
    // legacy Base64 JSON before Fastify parses it, avoiding a large in-memory
    // string plus decoded Buffer. Token mode remains backward compatible.
    onRequest: async (req, reply) => {
      if (!hasMultipartContentType(req) && userOf(req).via === 'cookie') {
        return reply.code(415).send({ error: 'Legacy JSON uploads are disabled; use multipart/form-data' });
      }
    },
  }, async (req, reply) => {
    const user = userOf(req);
    if (req.isMultipart()) {
      return receiveMultipartUploads(req, reply, user, uploadAdmission);
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

    let lease: UploadLease | undefined;
    const savedPaths: string[] = [];
    const scopeRoot = user.canonicalFsRoot || root;
    const scopeIdentity = user.canonicalFsRootIdentity;
    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) return reply.code(400).send({ error: 'cwd is not a directory' });
      const q = req.query as UploadQuery | undefined;
      lease = await uploadAdmission.acquire(admissionRequest(user, root, q));
      const uploadDir = await ensureSafeUploadDirectory(
        root,
        new Date().toISOString().slice(0, 10),
        scopeRoot,
        user.via,
        scopeIdentity,
      );

      const saved = [];
      for (const file of files) {
        lease.reserveFile();
        const name = sanitizeFileName(file?.name);
        const bytes = decodeUploadBytes(file?.dataBase64);
        if (bytes.byteLength === 0) throw new Error(`${name} is empty`);
        if (bytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
          throw new Error(`${name} is larger than 25 MB`);
        }
        lease.addBytes(bytes.byteLength);
        const path = await writeUniqueFile(uploadDir, name, bytes, root, scopeRoot, user.via, scopeIdentity);
        savedPaths.push(path);
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
      await Promise.all(savedPaths.map((path) => removeUploadedFileSafe(
        root,
        path,
        scopeRoot,
        user.via,
        scopeIdentity,
      )));
      return reply.code(uploadErrorStatus(e)).send({ error: uploadErrorMessage(e) });
    } finally {
      lease?.release();
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
      const { results, truncated } = await searchProjectFiles(root, needle, limit, { scopeUser: user });
      return { cwd: root, results, truncated };
    } catch (e) {
      return sendScoped(reply, e);
    }
  });

  app.get('/api/file', async (req, reply) => {
    const user = userOf(req);
    const q = req.query as { cwd?: string; path?: string; download?: string } | undefined;
    if (!q?.path) return reply.code(400).send({ error: 'path required' });
    let opened: ScopedOpenFile | undefined;
    try {
      const target = resolveProjectFile(q.cwd ?? user.workspaceRoot, q.path, user, defaultCwd);
      opened = await openScopedFile(user, target);
      const filename = basename(target);
      // Classify the canonical file, not a benign-looking symlink name.
      const activeContent = isActiveContentFile(opened.canonicalPath);
      const disposition = q.download === '1' || activeContent ? 'attachment' : 'inline';
      reply
        .header('content-type', activeContent ? 'application/octet-stream' : mimeForFile(opened.canonicalPath))
        .header('content-length', opened.stat.size)
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `${disposition}; filename="${headerSafeFilename(filename)}"`);
      if (activeContent) {
        // HTML, SVG and XML can execute script or trigger same-origin requests.
        // They are member-controlled artifacts, so never render them in the
        // authenticated application origin. CSP is a second line of defence
        // for clients that ignore Content-Disposition.
        reply.header('content-security-policy', "sandbox; default-src 'none'");
      }
      const stream = opened.handle.createReadStream({ autoClose: true });
      const streamOwner = opened;
      stream.once('close', () => { void streamOwner.close(); });
      stream.once('error', () => { void streamOwner.close(); });
      try {
        const response = reply.send(stream);
        opened = undefined; // The response stream owns and closes the handle.
        return response;
      } catch (error) {
        stream.destroy();
        throw error;
      }
    } catch (e) {
      await opened?.close().catch(() => undefined);
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

type UploadQuery = {
  cwd?: string;
  sessionKey?: string;
  selectionId?: string;
};

type UploadReply = {
  code: (status: number) => { send: (body: unknown) => unknown };
};

async function receiveMultipartUploads(
  req: FastifyRequest,
  reply: UploadReply,
  user: CcwUser,
  admission: UploadAdmissionController,
): Promise<unknown> {
  const q = req.query as UploadQuery | undefined;
  let root: string;
  try {
    root = resolveSafe(q?.cwd ?? user.workspaceRoot, user);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return reply.code(400).send({ error: 'cwd is not a directory' });
  } catch (e) {
    return sendScoped(reply, e);
  }

  let lease: UploadLease | undefined;
  const savedPaths: string[] = [];
  const saved: Array<{ name: string; path: string; relativePath: string; mime?: string; size: number }> = [];

  try {
    lease = await admission.acquire(admissionRequest(user, root, q));
    const scopeRoot = user.canonicalFsRoot || root;
    const scopeIdentity = user.canonicalFsRootIdentity;
    const uploadDir = await ensureSafeUploadDirectory(
      root,
      new Date().toISOString().slice(0, 10),
      scopeRoot,
      user.via,
      scopeIdentity,
    );
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const name = sanitizeFileName(part.filename);
      lease.reserveFile();
      const written = await writeUniqueUploadStream(
        uploadDir,
        name,
        part,
        lease,
        root,
        scopeRoot,
        user.via,
        scopeIdentity,
      );
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
    const scopeRoot = user.canonicalFsRoot || root;
    const scopeIdentity = user.canonicalFsRootIdentity;
    await Promise.all(savedPaths.map((path) => removeUploadedFileSafe(
      root,
      path,
      scopeRoot,
      user.via,
      scopeIdentity,
    )));
    const message = uploadErrorMessage(e);
    return reply.code(uploadErrorStatus(e)).send({ error: message });
  } finally {
    lease?.release();
  }
}

async function writeUniqueUploadStream(
  dir: string,
  name: string,
  part: MultipartFile,
  lease: UploadLease,
  root: string,
  scopeRoot: string,
  mode: CcwUser['via'],
  scopeIdentity: CcwUser['canonicalFsRootIdentity'],
): Promise<{ path: string; size: number }> {
  const reserved = await reserveUniqueFile(dir, name, root, scopeRoot, mode, scopeIdentity);
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      try {
        lease.addBytes(chunk.byteLength);
      } catch (error) {
        callback(error as Error);
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(part.file, counter, reserved.handle.createWriteStream());
    if (part.file.truncated) throw new Error(`${name} is larger than 25 MB`);
    if (size === 0) throw new Error(`${name} is empty`);
    await verifyReservedUploadFile(reserved, root, scopeRoot, mode, scopeIdentity);
    await closeReservedUploadFile(reserved);
    return { path: reserved.path, size };
  } catch (e) {
    await cleanupReservedUploadFile(reserved);
    throw e;
  }
}

type ReservedUploadFile = {
  path: string;
  safePath: string;
  name: string;
  handle: FileHandle;
  stat: Awaited<ReturnType<FileHandle['stat']>>;
  directory: SafeUploadDirectoryHandle;
};

async function reserveUniqueFile(
  dir: string,
  name: string,
  root: string,
  scopeRoot: string,
  mode: CcwUser['via'],
  scopeIdentity: CcwUser['canonicalFsRootIdentity'],
): Promise<ReservedUploadFile> {
  const directory = await openSafeUploadDirectory(root, dir, scopeRoot, mode, scopeIdentity);
  const ext = extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  try {
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? name : `${base}-${i + 1}${ext}`;
      const path = join(dir, candidate);
      const safePath = join(directory.accessPath, candidate);
      let handle: FileHandle | undefined;
      try {
        handle = await open(safePath, 'wx');
        let openedStat: Awaited<ReturnType<FileHandle['stat']>>;
        try {
          openedStat = await handle.stat();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await unlink(safePath).catch(() => undefined);
          throw error;
        }
        return { path, safePath, name: candidate, handle, stat: openedStat, directory };
      } catch (e) {
        await handle?.close().catch(() => undefined);
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    throw new Error(`Could not find a free filename for ${name}`);
  } catch (error) {
    await directory.close().catch(() => undefined);
    throw error;
  }
}

async function verifyReservedUploadFile(
  reserved: ReservedUploadFile,
  root: string,
  scopeRoot: string,
  mode: CcwUser['via'],
  scopeIdentity: CcwUser['canonicalFsRootIdentity'],
): Promise<void> {
  if (mode === 'token') {
    await assertSafeUploadDirectory(root, dirname(reserved.path), scopeRoot);
  }
  await reserved.directory.verify();
  const currentPath = await realpath(reserved.safePath);
  const expectedPath = join(reserved.directory.canonicalPath, reserved.name);
  if (currentPath !== expectedPath) throw new Error('Upload destination changed while uploading');
  const currentStat = await stat(currentPath);
  if (reserved.stat.dev !== currentStat.dev || reserved.stat.ino !== currentStat.ino) {
    throw new Error('Upload destination changed while uploading');
  }
}

async function closeReservedUploadFile(reserved: ReservedUploadFile): Promise<void> {
  await reserved.handle.close().catch(() => undefined);
  await reserved.directory.close().catch(() => undefined);
}

async function cleanupReservedUploadFile(reserved: ReservedUploadFile): Promise<void> {
  await reserved.handle.close().catch(() => undefined);
  // safePath remains pinned to the validated directory while its fd is open.
  await unlink(reserved.safePath).catch(() => undefined);
  await reserved.directory.close().catch(() => undefined);
}

async function removeUploadedFileSafe(
  root: string,
  path: string,
  scopeRoot: string,
  mode: CcwUser['via'],
  scopeIdentity: CcwUser['canonicalFsRootIdentity'],
): Promise<void> {
  let directory: SafeUploadDirectoryHandle | undefined;
  try {
    directory = await openSafeUploadDirectory(root, dirname(path), scopeRoot, mode, scopeIdentity);
    const candidate = join(directory.accessPath, basename(path));
    const currentPath = await realpath(candidate);
    if (currentPath !== join(directory.canonicalPath, basename(path))) return;
    await unlink(candidate);
  } catch {
    // Cleanup must never follow a directory that moved out of scope. Leaving a
    // partial file in the original, now-unreachable directory is safer.
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

function uploadErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') return 'A file is larger than 25 MB';
  if (code === 'FST_FILES_LIMIT') return `Upload at most ${MAX_UPLOAD_FILES} files at once`;
  return String((e as Error)?.message || e || 'Upload failed');
}

function uploadErrorStatus(e: unknown): number {
  const code = (e as { code?: string } | undefined)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') return 400;
  const statusCode = Number((e as { statusCode?: unknown } | undefined)?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 400;
}

function hasMultipartContentType(req: FastifyRequest): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && /^multipart\/form-data(?:;|$)/i.test(contentType.trim());
}

function admissionRequest(user: CcwUser, root: string, q: UploadQuery | undefined) {
  return {
    userKey: `${user.via}:${user.openId}`,
    cwd: root,
    sessionKey: q?.sessionKey,
    selectionId: q?.selectionId,
  };
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

function cleanTelemetryText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '';
}

function safeTelemetryCoordinate(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function decodeUploadBytes(dataBase64: string | undefined): Buffer {
  if (!dataBase64 || typeof dataBase64 !== 'string') throw new Error('dataBase64 required');
  const raw = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  return Buffer.from(raw, 'base64');
}

async function writeUniqueFile(
  dir: string,
  name: string,
  bytes: Buffer,
  root: string,
  scopeRoot: string,
  mode: CcwUser['via'],
  scopeIdentity: CcwUser['canonicalFsRootIdentity'],
): Promise<string> {
  const reserved = await reserveUniqueFile(dir, name, root, scopeRoot, mode, scopeIdentity);
  try {
    await reserved.handle.writeFile(bytes);
    await verifyReservedUploadFile(reserved, root, scopeRoot, mode, scopeIdentity);
    await closeReservedUploadFile(reserved);
    return reserved.path;
  } catch (error) {
    await cleanupReservedUploadFile(reserved);
    throw error;
  }
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

const ACTIVE_CONTENT_EXTENSIONS = new Set([
  '.htm', '.html', '.svg', '.svgz', '.xhtml', '.xml',
]);

function isActiveContentFile(path: string): boolean {
  return ACTIVE_CONTENT_EXTENSIONS.has(extname(path).toLowerCase());
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
  scopeUser?: CcwUser;
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
  await walk(root, root, needle.toLowerCase(), results, limit, 0, context, options.scopeUser);
  return { results, truncated: context.truncated };
}

async function walk(root: string, dir: string, needle: string, out: string[], limit: number, depth: number, context: FileSearchContext, scopeUser?: CcwUser): Promise<void> {
  if (out.length >= limit || depth > MAX_DEPTH) return;
  if (context.visited >= context.entryBudget || context.now() > context.deadline) {
    context.truncated = true;
    return;
  }
  let entries;
  if (scopeUser) {
    let directory;
    try {
      directory = await openScopedDirectory(scopeUser, dir);
      entries = await readdir(directory.accessPath, { withFileTypes: true });
    } catch {
      return;
    } finally {
      await directory?.close().catch(() => undefined);
    }
  } else {
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
  }
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
      await walk(root, full, needle, out, limit, depth + 1, context, scopeUser);
    } else if (e.isFile()) {
      if (!needle || rel.toLowerCase().includes(needle)) {
        out.push(rel);
      }
    }
  }
}
