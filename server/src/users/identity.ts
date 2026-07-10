import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { timingSafeEqualStr } from '../auth.js';
import { parseCookieHeader, verifySession, SESSION_COOKIE } from '../auth/cookie.js';
import type { CcwConfig } from '../config.js';
import type { UserRegistry, UserRole } from './registry.js';

export type CcwUser = {
  openId: string;
  email: string;
  name: string;
  slug: string;
  role: UserRole;
  isAdmin: boolean;
  /** How this request authenticated. Token auth keeps legacy single-user semantics. */
  via: 'token' | 'cookie';
  avatarUrl?: string;
  /** The user's own workspace (default cwd for new sessions). */
  workspaceRoot: string;
  /** The filesystem root this user may touch through the web API.
   * Empty string means unrestricted (legacy token mode). */
  fsRoot: string;
  /**
   * Canonical filesystem boundary captured from trusted server configuration
   * when the identity context is created. Cookie-authenticated requests must
   * never recompute their security boundary from a mutable workspace path.
   * Empty only for legacy token mode.
   */
  canonicalFsRoot: string;
  /** Device/inode bound to canonicalFsRoot before serving this user. */
  canonicalFsRootIdentity: FsRootIdentity | null;
};

export type FsRootIdentity = Readonly<{ dev: bigint; ino: bigint }>;

type UserRootBinding = {
  canonicalPath: string;
  identity: FsRootIdentity;
};

export type IdentityContext = {
  token: string;
  defaultCwd: string;
  config: CcwConfig;
  registry?: UserRegistry;
  canonicalDataRoot: string;
  canonicalUsersRoot: string;
  canonicalDataRootIdentity: FsRootIdentity | null;
  canonicalUsersRootIdentity: FsRootIdentity | null;
  userRootBindings: Map<string, UserRootBinding>;
  knownUsersAtStartup: Set<string>;
};

type RequestLike = {
  query?: unknown;
  headers: { cookie?: string; origin?: string };
};

/** Synthetic identity for legacy token auth: full access, anchored at $HOME. */
export function tokenAdmin(defaultCwd: string): CcwUser {
  return {
    openId: '_token',
    email: '',
    name: 'Token admin',
    slug: '_token',
    role: 'admin',
    isAdmin: true,
    via: 'token',
    workspaceRoot: defaultCwd,
    fsRoot: '',
    canonicalFsRoot: '',
    canonicalFsRootIdentity: null,
  };
}

/**
 * Build the identity context once at server startup. In Feishu mode the
 * configured data directory is trusted, but the directory tree below it can
 * be changed by workspace processes. Capture the canonical configured root
 * now and project the users directory from it instead of re-realpathing a
 * mutable path for every request.
 */
export function createIdentityContext(input: {
  token: string;
  defaultCwd: string;
  config: CcwConfig;
  registry?: UserRegistry;
}): IdentityContext {
  if (input.config.authMode !== 'feishu') {
    return {
      ...input,
      canonicalDataRoot: '',
      canonicalUsersRoot: '',
      canonicalDataRootIdentity: null,
      canonicalUsersRootIdentity: null,
      userRootBindings: new Map(),
      knownUsersAtStartup: new Set(),
    };
  }

  const lexicalDataRoot = resolve(input.config.dataDir);
  const lexicalUsersRoot = resolve(input.config.usersRoot);
  if (!isPathInside(lexicalDataRoot, lexicalUsersRoot)) {
    throw new Error('Configured users root is outside the data directory');
  }
  const canonicalDataRoot = canonicalPathFromNearestAncestor(lexicalDataRoot);
  const canonicalUsersRoot = resolve(
    canonicalDataRoot,
    relative(lexicalDataRoot, lexicalUsersRoot),
  );
  const canonicalDataRootIdentity = captureFsRootIdentity(canonicalDataRoot);
  const canonicalUsersRootIdentity = createUsersRootFromPinnedDataRoot(
    canonicalDataRoot,
    canonicalDataRootIdentity,
    relative(canonicalDataRoot, canonicalUsersRoot),
  );
  const userRootBindings = new Map<string, UserRootBinding>();
  const knownUsersAtStartup = new Set<string>();
  for (const stored of input.registry?.list() ?? []) {
    knownUsersAtStartup.add(stored.openId);
    const canonicalPath = canonicalUserRoot(canonicalUsersRoot, stored.slug);
    try {
      const identity = captureUserRootFromPinnedUsersRoot(
        canonicalUsersRoot,
        canonicalUsersRootIdentity,
        stored.slug,
      );
      userRootBindings.set(stored.openId, { canonicalPath, identity });
    } catch {
      // One broken/missing member workspace must not take down every user.
      // Because the id is recorded in knownUsersAtStartup it remains unbound
      // and denied until a trusted login provisioning flow binds it.
    }
  }
  return {
    ...input,
    canonicalDataRoot,
    canonicalUsersRoot,
    canonicalDataRootIdentity,
    canonicalUsersRootIdentity,
    userRootBindings,
    knownUsersAtStartup,
  };
}

/** Bind a freshly provisioned workspace before issuing its login cookie. */
export function captureUserRootIdentity(
  ctx: IdentityContext,
  user: { openId: string; slug: string },
): FsRootIdentity {
  if (!ctx.canonicalUsersRoot) throw new Error('Identity context has no users root');
  const identity = captureUserRootFromPinnedUsersRoot(
    ctx.canonicalUsersRoot,
    ctx.canonicalUsersRootIdentity!,
    user.slug,
  );
  bindUserRootIdentity(ctx, user, identity);
  return identity;
}

export function bindUserRootIdentity(
  ctx: IdentityContext,
  user: { openId: string; slug: string },
  identity: FsRootIdentity,
): void {
  const canonicalPath = canonicalUserRoot(ctx.canonicalUsersRoot, user.slug);
  const existing = ctx.userRootBindings.get(user.openId);
  if (existing && (
    existing.canonicalPath !== canonicalPath
    || !sameFsRootIdentity(existing.identity, identity)
  )) {
    throw new Error('Workspace root identity changed');
  }
  ctx.knownUsersAtStartup.add(user.openId);
  ctx.userRootBindings.set(user.openId, { canonicalPath, identity });
}

export function boundUserRootIdentity(
  ctx: IdentityContext,
  openId: string,
): FsRootIdentity | undefined {
  return ctx.userRootBindings.get(openId)?.identity;
}

/** Bind a registry user that appeared after this release process started. */
export function bindNewlyDiscoveredUserRoot(
  ctx: IdentityContext,
  user: { openId: string; slug: string },
): FsRootIdentity | undefined {
  const existing = boundUserRootIdentity(ctx, user.openId);
  if (existing) return existing;
  if (ctx.knownUsersAtStartup.has(user.openId) || !ctx.canonicalUsersRootIdentity) return undefined;
  try {
    const identity = captureUserRootFromPinnedUsersRoot(
      ctx.canonicalUsersRoot,
      ctx.canonicalUsersRootIdentity,
      user.slug,
    );
    bindUserRootIdentity(ctx, user, identity);
    return identity;
  } catch {
    return undefined;
  }
}

export function resolveUser(req: RequestLike, ctx: IdentityContext): CcwUser | null {
  const provided = (req.query as { t?: string } | undefined)?.t ?? '';
  if (provided && timingSafeEqualStr(provided, ctx.token)) {
    return tokenAdmin(ctx.defaultCwd);
  }
  if (ctx.config.authMode !== 'feishu' || !ctx.registry) return null;

  const cookies = parseCookieHeader(req.headers.cookie);
  const payload = verifySession(cookies[SESSION_COOKIE], ctx.config.cookieSecret);
  if (!payload) return null;

  const stored = ctx.registry.getByOpenId(payload.sub);
  if (!stored || stored.disabled) return null;
  // Re-check the allowlist on every request so removing someone takes effect
  // immediately, not at cookie expiry.
  if (!ctx.registry.isAllowed({ email: stored.email, openId: stored.openId })) return null;

  const workspaceRoot = join(ctx.config.usersRoot, stored.slug);
  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = canonicalUserRoot(ctx.canonicalUsersRoot, stored.slug);
  } catch {
    return null;
  }
  if (
    !ctx.canonicalDataRoot
    || !ctx.canonicalUsersRoot
    || !isPathInside(ctx.canonicalUsersRoot, canonicalWorkspaceRoot)
  ) {
    return null;
  }
  let userBinding = ctx.userRootBindings.get(stored.openId);
  if (!userBinding && !ctx.knownUsersAtStartup.has(stored.openId)) {
    // A user created by another release process after this server started may
    // first appear here. The registry entry is trusted; bind its provisioned
    // root exactly once, then require the same inode for every later request.
    try {
      const identity = bindNewlyDiscoveredUserRoot(ctx, stored);
      if (!identity) return null;
      userBinding = { canonicalPath: canonicalWorkspaceRoot, identity };
    } catch {
      return null;
    }
  }
  if (
    stored.role !== 'admin'
    && (!userBinding || userBinding.canonicalPath !== canonicalWorkspaceRoot)
  ) {
    return null;
  }
  const canonicalFsRoot = stored.role === 'admin' ? ctx.canonicalDataRoot : canonicalWorkspaceRoot;
  const canonicalFsRootIdentity = stored.role === 'admin'
    ? ctx.canonicalDataRootIdentity
    : userBinding!.identity;
  if (!canonicalFsRootIdentity) return null;
  try {
    assertFsRootIdentity(canonicalFsRoot, canonicalFsRootIdentity);
  } catch {
    return null;
  }
  return {
    openId: stored.openId,
    email: stored.email,
    name: stored.name,
    slug: stored.slug,
    role: stored.role,
    isAdmin: stored.role === 'admin',
    via: 'cookie',
    avatarUrl: stored.avatarUrl,
    workspaceRoot,
    // Admins may see all user workspaces (and the shared scaffolding) but not
    // the rest of the filesystem — raw access stays an SSH-only power.
    fsRoot: stored.role === 'admin' ? ctx.config.dataDir : workspaceRoot,
    canonicalFsRoot,
    canonicalFsRootIdentity,
  };
}

/** Where path resolution anchors for relative paths and browse defaults. */
export function fsAnchor(user: CcwUser): string {
  return user.fsRoot || homedir();
}

export class ScopeError extends Error {
  statusCode = 403;
  constructor() {
    super('Path is outside your workspace');
  }
}

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertInScope(user: CcwUser, target: string): void {
  if (!user.fsRoot) return; // Legacy token auth: single-user, unrestricted.
  assertUserFsRootIdentity(user);
  const lexicalRoot = resolve(user.fsRoot);
  const lexicalTarget = resolve(target);
  if (!isPathInside(lexicalRoot, lexicalTarget)) throw new ScopeError();

  // A lexical prefix check is not a security boundary: `workspace/link/file`
  // may resolve through `link` into another member's workspace (or /etc).
  // Resolve both sides through the nearest existing ancestor so the same rule
  // also covers paths that are about to be created.
  if (!user.canonicalFsRoot) throw new ScopeError();
  const canonicalRoot = resolve(user.canonicalFsRoot);
  const canonicalTarget = canonicalPathFromNearestAncestor(lexicalTarget);
  if (!isPathInside(canonicalRoot, canonicalTarget)) throw new ScopeError();
}

export function assertUserFsRootIdentity(user: CcwUser): void {
  if (user.via === 'token') return;
  if (!user.canonicalFsRoot || !user.canonicalFsRootIdentity) throw new ScopeError();
  assertFsRootIdentity(user.canonicalFsRoot, user.canonicalFsRootIdentity);
}

export function captureFsRootIdentity(path: string): FsRootIdentity {
  const expected = resolve(path);
  const info = lstatSync(expected, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || resolve(realpathSync(expected)) !== expected) {
    throw new Error('Filesystem root must be a real directory');
  }
  return { dev: info.dev, ino: info.ino };
}

export function assertFsRootIdentity(path: string, expected: FsRootIdentity): void {
  try {
    const current = captureFsRootIdentity(path);
    if (!sameFsRootIdentity(current, expected)) throw new ScopeError();
  } catch (error) {
    if (error instanceof ScopeError) throw error;
    throw new ScopeError();
  }
}

export function sameFsRootIdentity(left: FsRootIdentity, right: FsRootIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Resolve a caller-supplied path against the user's anchor and enforce scope. */
export function resolveScoped(p: string, user: CcwUser): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(fsAnchor(user), p);
  assertInScope(user, abs);
  return abs;
}

/**
 * Resolve an already-scoped path to its canonical destination. Non-existent
 * suffixes are projected from the closest existing ancestor, which prevents a
 * symlink immediately above a future file/directory from bypassing the scope.
 */
export function canonicalScopedPath(p: string, user: CcwUser): string {
  const abs = resolveScoped(p, user);
  return canonicalPathFromNearestAncestor(abs);
}

export type ScopedOpenFile = {
  handle: FileHandle;
  stat: Awaited<ReturnType<FileHandle['stat']>>;
  canonicalPath: string;
  close: () => Promise<void>;
};

export type ScopedOpenDirectory = {
  handle: FileHandle;
  stat: Awaited<ReturnType<FileHandle['stat']>>;
  canonicalPath: string;
  /** Stable directory-fd path on Linux; canonical path elsewhere. */
  accessPath: string;
  close: () => Promise<void>;
};

/**
 * Open a file without following the final component, then verify the opened
 * inode rather than trusting the path checked before open. On Linux (the
 * production platform), /proc/self/fd gives the kernel-resolved destination;
 * elsewhere an inode comparison provides an equivalent fail-closed check.
 */
export async function openScopedFile(user: CcwUser, target: string): Promise<ScopedOpenFile> {
  const canonicalPath = canonicalScopedPath(target, user);
  if (user.via === 'cookie') {
    const pinned = await openPinnedScopedTarget(user, canonicalPath, false);
    return {
      handle: pinned.handle,
      stat: pinned.stat,
      canonicalPath,
      close: pinned.close,
    };
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(canonicalPath, constants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new Error('path is not a file');
    return { handle, stat: openedStat, canonicalPath, close: closeOnce([handle]) };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/** Open and pin a scoped directory. Linux callers can traverse accessPath
 * without a path-swap window because it is backed by the opened directory fd. */
export async function openScopedDirectory(user: CcwUser, target: string): Promise<ScopedOpenDirectory> {
  const canonicalPath = canonicalScopedPath(target, user);
  if (user.via === 'cookie') {
    const pinned = await openPinnedScopedTarget(user, canonicalPath, true);
    return {
      handle: pinned.handle,
      stat: pinned.stat,
      canonicalPath,
      accessPath: `/proc/${process.pid}/fd/${pinned.handle.fd}`,
      close: pinned.close,
    };
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const directory = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const handle = await open(canonicalPath, constants.O_RDONLY | noFollow | directory);
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isDirectory()) throw new Error('path is not a directory');
    return {
      handle,
      stat: openedStat,
      canonicalPath,
      accessPath: canonicalPath,
      close: closeOnce([handle]),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

type PinnedScopedTarget = {
  handle: FileHandle;
  stat: Awaited<ReturnType<FileHandle['stat']>>;
  close: () => Promise<void>;
};

async function openPinnedScopedTarget(
  user: CcwUser,
  canonicalTarget: string,
  wantDirectory: boolean,
): Promise<PinnedScopedTarget> {
  if (process.platform !== 'linux' || !user.canonicalFsRootIdentity) throw new ScopeError();
  const root = resolve(user.canonicalFsRoot);
  const rel = relative(root, canonicalTarget);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new ScopeError();

  const directoryFlag = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const guards: FileHandle[] = [];
  let current: FileHandle | undefined;
  try {
    current = await open(root, constants.O_RDONLY | directoryFlag | noFollow);
    const rootStat = await current.stat({ bigint: true });
    if (
      !rootStat.isDirectory()
      || rootStat.dev !== user.canonicalFsRootIdentity.dev
      || rootStat.ino !== user.canonicalFsRootIdentity.ino
      || realpathSync(`/proc/${process.pid}/fd/${current.fd}`) !== root
    ) {
      throw new ScopeError();
    }

    const components = rel.split(sep).filter(Boolean);
    for (let index = 0; index < components.length; index++) {
      const component = components[index]!;
      if (component === '.' || component === '..' || component.includes(sep)) throw new ScopeError();
      const final = index === components.length - 1;
      const flags = constants.O_RDONLY | noFollow | (!final || wantDirectory ? directoryFlag : 0);
      const next = await open(`/proc/${process.pid}/fd/${current.fd}/${component}`, flags);
      guards.push(current);
      current = next;
      const expected = resolve(root, ...components.slice(0, index + 1));
      if (realpathSync(`/proc/${process.pid}/fd/${current.fd}`) !== expected) throw new ScopeError();
    }

    const openedStat = await current.stat();
    if (wantDirectory ? !openedStat.isDirectory() : !openedStat.isFile()) {
      throw new Error(wantDirectory ? 'path is not a directory' : 'path is not a file');
    }
    const owned = [current, ...guards];
    return { handle: current, stat: openedStat, close: closeOnce(owned) };
  } catch (error) {
    await Promise.allSettled([current, ...guards].filter(Boolean).map((handle) => handle!.close()));
    if (error instanceof ScopeError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR') throw new ScopeError();
    throw error;
  }
}

function closeOnce(handles: FileHandle[]): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled(handles.map((handle) => handle.close()));
  };
}

function canonicalPathFromNearestAncestor(target: string): string {
  let current = resolve(target);
  const missing: string[] = [];

  for (;;) {
    try {
      // lstat distinguishes a genuinely missing suffix from a dangling link.
      // A dangling/cyclic/inaccessible link is never safe to project through.
      lstatSync(current);
      let canonical: string;
      try {
        canonical = realpathSync(current);
      } catch {
        throw new ScopeError();
      }
      return resolve(canonical, ...missing);
    } catch (error) {
      if (error instanceof ScopeError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw new ScopeError();
      const parent = resolve(current, '..');
      if (parent === current) throw new ScopeError();
      missing.unshift(current.slice(parent.length + (parent.endsWith('/') ? 0 : 1)));
      current = parent;
    }
  }
}

function canonicalUserRoot(canonicalUsersRoot: string, slug: string): string {
  const canonicalPath = resolve(canonicalUsersRoot, slug);
  if (!isPathInside(canonicalUsersRoot, canonicalPath)) {
    throw new Error('User workspace is outside the users root');
  }
  return canonicalPath;
}

function createUsersRootFromPinnedDataRoot(
  canonicalDataRoot: string,
  expectedDataIdentity: FsRootIdentity,
  usersRelativePath: string,
): FsRootIdentity {
  if (process.platform !== 'linux') {
    return captureFsRootIdentity(resolve(canonicalDataRoot, usersRelativePath));
  }
  if (
    !usersRelativePath
    || usersRelativePath === '..'
    || usersRelativePath.startsWith(`..${sep}`)
    || isAbsolute(usersRelativePath)
  ) {
    throw new Error('Configured users root is outside the data directory');
  }
  const directoryFlag = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handles: number[] = [];
  try {
    let current = openSync(canonicalDataRoot, constants.O_RDONLY | directoryFlag | noFollow);
    handles.push(current);
    const rootStat = fstatSync(current, { bigint: true });
    if (
      rootStat.dev !== expectedDataIdentity.dev
      || rootStat.ino !== expectedDataIdentity.ino
      || realpathSync(`/proc/${process.pid}/fd/${current}`) !== canonicalDataRoot
    ) {
      throw new Error('Configured data root identity changed');
    }
    let expected = canonicalDataRoot;
    for (const component of usersRelativePath.split(sep).filter(Boolean)) {
      if (component === '.' || component === '..' || component.includes(sep)) {
        throw new Error('Invalid users root component');
      }
      const childPath = `/proc/${process.pid}/fd/${current}/${component}`;
      try {
        mkdirSync(childPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const child = openSync(childPath, constants.O_RDONLY | directoryFlag | noFollow);
      handles.push(child);
      current = child;
      expected = join(expected, component);
      if (realpathSync(`/proc/${process.pid}/fd/${current}`) !== expected) {
        throw new Error('Configured users root identity changed');
      }
    }
    const finalStat = fstatSync(current, { bigint: true });
    return { dev: finalStat.dev, ino: finalStat.ino };
  } finally {
    for (const handle of handles.reverse()) {
      try { closeSync(handle); } catch { /* best effort */ }
    }
  }
}

function captureUserRootFromPinnedUsersRoot(
  canonicalUsersRoot: string,
  expectedUsersIdentity: FsRootIdentity,
  slug: string,
): FsRootIdentity {
  const expected = canonicalUserRoot(canonicalUsersRoot, slug);
  if (process.platform !== 'linux') {
    // Non-Linux scoped I/O fails closed. Keeping this portable capture makes
    // identity substitution regression tests deterministic on developer Macs.
    return captureFsRootIdentity(expected);
  }
  const directoryFlag = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let rootFd: number | undefined;
  let childFd: number | undefined;
  try {
    rootFd = openSync(canonicalUsersRoot, constants.O_RDONLY | directoryFlag | noFollow);
    const rootStat = fstatSync(rootFd, { bigint: true });
    if (
      rootStat.dev !== expectedUsersIdentity.dev
      || rootStat.ino !== expectedUsersIdentity.ino
      || realpathSync(`/proc/${process.pid}/fd/${rootFd}`) !== canonicalUsersRoot
    ) {
      throw new Error('Users root identity changed');
    }
    childFd = openSync(
      `/proc/${process.pid}/fd/${rootFd}/${slug}`,
      constants.O_RDONLY | directoryFlag | noFollow,
    );
    if (realpathSync(`/proc/${process.pid}/fd/${childFd}`) !== expected) {
      throw new Error('Workspace root moved outside users root');
    }
    const childStat = fstatSync(childFd, { bigint: true });
    if (!childStat.isDirectory()) throw new Error('Workspace root is not a directory');
    return { dev: childStat.dev, ino: childStat.ino };
  } finally {
    if (childFd !== undefined) try { closeSync(childFd); } catch { /* best effort */ }
    if (rootFd !== undefined) try { closeSync(rootFd); } catch { /* best effort */ }
  }
}
