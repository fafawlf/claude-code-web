import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sameFsRootIdentity, type FsRootIdentity } from './users/identity.js';

export const DEFAULT_UPLOAD_CONCURRENCY = 2;
export const DEFAULT_UPLOAD_MAX_WAITERS = 12;
export const DEFAULT_UPLOAD_ROLLING_WINDOW_MS = 60_000;

type Budget = {
  files: number;
  bytes: number;
  expiresAt: number;
  selections: Map<string, SelectionBudget>;
};

type SelectionBudget = { files: number; bytes: number };

type Waiter = {
  resolve: () => void;
};

export type UploadAdmissionOptions = {
  maxFiles: number;
  maxBytes: number;
  concurrency?: number;
  maxWaiters?: number;
  rollingWindowMs?: number;
  now?: () => number;
};

export type UploadAdmissionRequest = {
  userKey: string;
  cwd: string;
  sessionKey?: string;
  selectionId?: string;
};

export type UploadLease = {
  reserveFile: () => void;
  addBytes: (bytes: number) => void;
  release: () => void;
};

/**
 * Admission control shared by every upload request registered on one server.
 * A per-user/cwd rolling budget prevents clients from evading the documented
 * selection limits by sending one file per request or inventing selection ids.
 * The narrower session/selection budget keeps honest retries grouped together.
 */
export class UploadAdmissionController {
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, Waiter[]>();
  private readonly budgets = new Map<string, Budget>();
  private readonly concurrency: number;
  private readonly maxWaiters: number;
  private readonly rollingWindowMs: number;
  private readonly now: () => number;

  constructor(private readonly options: UploadAdmissionOptions) {
    this.concurrency = options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY;
    this.maxWaiters = options.maxWaiters ?? DEFAULT_UPLOAD_MAX_WAITERS;
    this.rollingWindowMs = options.rollingWindowMs ?? DEFAULT_UPLOAD_ROLLING_WINDOW_MS;
    this.now = options.now ?? Date.now;
    if (this.concurrency < 1 || this.maxWaiters < 0 || this.rollingWindowMs < 1) {
      throw new Error('Invalid upload admission limits');
    }
  }

  async acquire(request: UploadAdmissionRequest): Promise<UploadLease> {
    this.pruneBudgets();
    const identity = encodeKey(request.userKey, resolve(request.cwd));
    await this.enter(identity);

    const rolling = this.budget(`rolling\0${identity}`);
    const selectionKey = encodeKey(
      identity,
      boundedKey(request.sessionKey),
      boundedKey(request.selectionId),
    );
    let selection: SelectionBudget | undefined;
    let released = false;

    return {
      reserveFile: () => {
        selection ??= selectionBudget(rolling, selectionKey);
        if (rolling.files + 1 > this.options.maxFiles || selection.files + 1 > this.options.maxFiles) {
          throw new UploadQuotaError(`Upload at most ${this.options.maxFiles} files per selection`);
        }
        rolling.files += 1;
        selection.files += 1;
      },
      addBytes: (bytes) => {
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid upload byte count');
        if (!selection) throw new Error('Upload file was not reserved');
        if (rolling.bytes + bytes > this.options.maxBytes || selection.bytes + bytes > this.options.maxBytes) {
          throw new UploadQuotaError('Uploads are larger than the 50 MB total limit');
        }
        rolling.bytes += bytes;
        selection.bytes += bytes;
      },
      release: () => {
        if (released) return;
        released = true;
        this.leave(identity);
      },
    };
  }

  private budget(key: string): Budget {
    const existing = this.budgets.get(key);
    if (existing && existing.expiresAt > this.now()) return existing;
    const created = {
      files: 0,
      bytes: 0,
      expiresAt: this.now() + this.rollingWindowMs,
      selections: new Map<string, SelectionBudget>(),
    };
    this.budgets.set(key, created);
    return created;
  }

  private pruneBudgets(): void {
    const now = this.now();
    for (const [key, budget] of this.budgets) {
      if (budget.expiresAt <= now) this.budgets.delete(key);
    }
  }

  private enter(key: string): Promise<void> {
    const active = this.active.get(key) ?? 0;
    if (active < this.concurrency) {
      this.active.set(key, active + 1);
      return Promise.resolve();
    }
    const queue = this.queues.get(key) ?? [];
    if (queue.length >= this.maxWaiters) {
      return Promise.reject(new UploadBusyError('Too many uploads are already queued'));
    }
    this.queues.set(key, queue);
    return new Promise<void>((resolvePromise) => queue.push({ resolve: resolvePromise }));
  }

  private leave(key: string): void {
    const queue = this.queues.get(key);
    const next = queue?.shift();
    if (queue?.length === 0) this.queues.delete(key);
    if (next) {
      // The slot stays occupied while ownership moves to the next waiter.
      next.resolve();
      return;
    }
    const active = (this.active.get(key) ?? 1) - 1;
    if (active > 0) this.active.set(key, active);
    else this.active.delete(key);
  }
}

export class UploadQuotaError extends Error {
  readonly statusCode = 400;
}

export class UploadBusyError extends Error {
  readonly statusCode = 429;
}

export type UploadSecurityMode = 'token' | 'cookie';

/**
 * Creates the private upload tree one component at a time. Existing symlinks
 * are rejected before and after mkdir, and realpath must remain anchored below
 * the caller-selected project root. This intentionally fails closed.
 */
export async function ensureSafeUploadDirectory(
  root: string,
  date: string,
  scopeRoot = root,
  mode: UploadSecurityMode = 'token',
  scopeIdentity: FsRootIdentity | null = null,
): Promise<string> {
  if (mode === 'cookie') {
    if (!scopeIdentity) throw new Error('Secure cookie uploads require a filesystem root identity');
    return ensurePinnedUploadDirectory(root, date, scopeRoot, scopeIdentity);
  }
  return ensurePortableUploadDirectory(root, date, scopeRoot);
}

async function ensurePortableUploadDirectory(root: string, date: string, scopeRoot: string): Promise<string> {
  const base = resolve(root);
  await assertRealDirectoryTree(scopeRoot, base);
  const canonicalBase = await realpath(base);
  let current = base;

  for (const component of ['.claudecode-web', 'uploads', date]) {
    current = join(current, component);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw new Error('Upload directory must not contain symbolic links');
    }
    const canonicalCurrent = await realpath(current);
    const expected = resolve(canonicalBase, relative(base, current));
    if (canonicalCurrent !== expected) {
      throw new Error('Upload directory must not contain symbolic links');
    }
  }
  return current;
}

export async function assertSafeUploadDirectory(root: string, uploadDir: string, scopeRoot = root): Promise<void> {
  const base = resolve(root);
  await assertRealDirectoryTree(scopeRoot, base);
  const canonicalBase = await realpath(base);
  const canonicalUploadDir = await realpath(uploadDir);
  const expected = resolve(canonicalBase, relative(base, resolve(uploadDir)));
  const uploadStat = await lstat(uploadDir);
  if (uploadStat.isSymbolicLink() || !uploadStat.isDirectory() || canonicalUploadDir !== expected) {
    throw new Error('Upload directory must not contain symbolic links');
  }
}

export type SafeUploadDirectoryHandle = {
  handle: FileHandle;
  canonicalPath: string;
  /** Stable fd-backed path on Linux, canonical path on other platforms. */
  accessPath: string;
  /** Re-check every held fd still resolves to its expected in-scope path. */
  verify: () => Promise<void>;
  /** Close the destination and every ancestor fd held as its safety chain. */
  close: () => Promise<void>;
};

/**
 * Pin the already-validated upload directory before a file is created. The
 * expected path is derived from the canonical project root, not from the
 * potentially swapped upload path. This closes the check/open gap on Linux.
 */
export async function openSafeUploadDirectory(
  root: string,
  uploadDir: string,
  scopeRoot = root,
  mode: UploadSecurityMode = 'token',
  scopeIdentity: FsRootIdentity | null = null,
): Promise<SafeUploadDirectoryHandle> {
  if (mode === 'cookie') {
    if (!scopeIdentity) throw new Error('Secure cookie uploads require a filesystem root identity');
    return openPinnedUploadDirectory(root, uploadDir, scopeRoot, scopeIdentity);
  }
  await assertSafeUploadDirectory(root, uploadDir, scopeRoot);
  const base = resolve(root);
  const canonicalBase = await realpath(base);
  const canonicalPath = resolve(canonicalBase, relative(base, resolve(uploadDir)));
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const directory = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const handle = await open(canonicalPath, constants.O_RDONLY | noFollow | directory);

  try {
    const openedStat = await handle.stat();
    if (!openedStat.isDirectory()) throw new Error('Upload directory must be a directory');
    let kernelPath: string | undefined;
    if (process.platform === 'linux') {
      try { kernelPath = await realpath(`/proc/self/fd/${handle.fd}`); } catch { /* portable fallback below */ }
    }

    if (kernelPath) {
      if (kernelPath !== canonicalPath) throw new Error('Upload directory changed while uploading');
    } else {
      const currentPath = await realpath(uploadDir);
      const currentStat = await stat(currentPath);
      if (
        currentPath !== canonicalPath
        || currentStat.dev !== openedStat.dev
        || currentStat.ino !== openedStat.ino
      ) {
        throw new Error('Upload directory changed while uploading');
      }
    }

    // Detect a scope/root swap that happened while the directory was opened.
    await assertSafeUploadDirectory(root, uploadDir, scopeRoot);
    return {
      handle,
      canonicalPath,
      accessPath: process.platform === 'linux' && kernelPath ? `/proc/self/fd/${handle.fd}` : canonicalPath,
      verify: async () => undefined,
      close: closeOnce([handle]),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Cookie mode is supported only when Linux exposes a real fd-backed path. The
 * scope root is opened and verified before any mkdir, then every descendant is
 * opened relative to the pinned parent with O_DIRECTORY|O_NOFOLLOW. No
 * attacker-controlled path is used for a write before it is below a held fd.
 */
async function ensurePinnedUploadDirectory(
  root: string,
  date: string,
  scopeRoot: string,
  scopeIdentity: FsRootIdentity,
): Promise<string> {
  assertSafeComponent(date);
  requireLinuxFdPaths();

  const base = resolve(root);
  const stableScopeRoot = resolve(scopeRoot);
  const canonicalBase = await realpath(base);
  assertDescendant(stableScopeRoot, canonicalBase);

  let current = await openPinnedDescendant(stableScopeRoot, canonicalBase, scopeIdentity);
  try {
    // The caller's project path must still name the directory we pinned. A
    // concurrent rename is safe (writes remain fd-relative) but is reported as
    // a failed upload rather than writing into a surprising old location.
    if (await realpath(base) !== canonicalBase) {
      throw new Error('Upload directory changed while uploading');
    }

    let canonicalCurrent = canonicalBase;
    for (const component of ['.claudecode-web', 'uploads', date]) {
      await verifyPinnedChain(current);
      assertSafeComponent(component);
      const childPath = join(current.accessPath, component);
      await mkdir(childPath, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const expected = join(canonicalCurrent, component);
      const child = await openPinnedChild(current, component, expected);
      current = {
        ...child,
        guards: [...current.guards, { handle: current.handle, canonicalPath: current.canonicalPath }],
      };
      canonicalCurrent = expected;
    }
    await verifyPinnedChain(current);
  } finally {
    await closePinnedChain(current);
  }
  return join(base, '.claudecode-web', 'uploads', date);
}

async function openPinnedUploadDirectory(
  root: string,
  uploadDir: string,
  scopeRoot: string,
  scopeIdentity: FsRootIdentity,
): Promise<SafeUploadDirectoryHandle> {
  requireLinuxFdPaths();
  const base = resolve(root);
  const destination = resolve(uploadDir);
  const lexicalRelative = relative(base, destination);
  if (lexicalRelative === '..' || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    throw new Error('Upload directory is outside the workspace');
  }

  const stableScopeRoot = resolve(scopeRoot);
  const canonicalBase = await realpath(base);
  const canonicalDestination = await realpath(destination);
  const expectedDestination = resolve(canonicalBase, lexicalRelative);
  if (canonicalDestination !== expectedDestination) {
    throw new Error('Upload directory must not contain symbolic links');
  }
  assertDescendant(stableScopeRoot, canonicalBase);
  assertDescendant(stableScopeRoot, canonicalDestination);

  const pinned = await openPinnedDescendant(stableScopeRoot, canonicalDestination, scopeIdentity);
  try {
    if (
      await realpath(base) !== canonicalBase
      || await realpath(destination) !== canonicalDestination
    ) {
      throw new Error('Upload directory changed while uploading');
    }
    await verifyPinnedChain(pinned);
    return safeHandleFromPinned(pinned);
  } catch (error) {
    await closePinnedChain(pinned);
    throw error;
  }
}

type PinnedGuard = { handle: FileHandle; canonicalPath: string };
type PinnedDirectory = {
  handle: FileHandle;
  canonicalPath: string;
  accessPath: string;
  guards: PinnedGuard[];
};

async function openPinnedDescendant(
  root: string,
  target: string,
  rootIdentity: FsRootIdentity,
): Promise<PinnedDirectory> {
  requireLinuxFdPaths();
  const stableRoot = resolve(root);
  const destination = resolve(target);
  assertDescendant(stableRoot, destination);

  let current = await openPinnedRoot(stableRoot, rootIdentity);
  try {
    const rel = relative(stableRoot, destination);
    for (const component of rel.split(sep).filter(Boolean)) {
      assertSafeComponent(component);
      const expected = join(current.canonicalPath, component);
      const child = await openPinnedChild(current, component, expected);
      current = {
        ...child,
        guards: [...current.guards, { handle: current.handle, canonicalPath: current.canonicalPath }],
      };
    }
    await verifyPinnedChain(current);
    return current;
  } catch (error) {
    await closePinnedChain(current);
    throw error;
  }
}

async function openPinnedRoot(root: string, expectedIdentity: FsRootIdentity): Promise<PinnedDirectory> {
  const handle = await openDirectoryNoFollow(root);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFsRootIdentity({ dev: opened.dev, ino: opened.ino }, expectedIdentity)) {
      throw new Error('Upload filesystem root identity changed');
    }
    return { ...await describePinnedDirectory(handle, root), guards: [] };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function openPinnedChild(
  parent: PinnedDirectory,
  component: string,
  expected: string,
): Promise<PinnedDirectory> {
  const handle = await openDirectoryNoFollow(join(parent.accessPath, component));
  try {
    return { ...await describePinnedDirectory(handle, expected), guards: [] };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function openDirectoryNoFollow(path: string): Promise<FileHandle> {
  if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_DIRECTORY !== 'number') {
    throw new Error('Secure uploads require Linux O_NOFOLLOW and O_DIRECTORY');
  }
  return open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
}

async function describePinnedDirectory(
  handle: FileHandle,
  expected: string,
): Promise<Omit<PinnedDirectory, 'guards'>> {
  const openedStat = await handle.stat();
  if (!openedStat.isDirectory()) throw new Error('Upload directory must be a directory');
  const accessPath = `/proc/${process.pid}/fd/${handle.fd}`;
  let kernelPath: string;
  try {
    kernelPath = await realpath(accessPath);
  } catch {
    throw new Error('Secure uploads require Linux /proc fd paths');
  }
  if (kernelPath !== resolve(expected)) {
    throw new Error('Upload directory changed while uploading');
  }
  return { handle, canonicalPath: kernelPath, accessPath };
}

async function verifyPinnedChain(directory: PinnedDirectory): Promise<void> {
  for (const pinned of [...directory.guards, { handle: directory.handle, canonicalPath: directory.canonicalPath }]) {
    let current: string;
    try {
      current = await realpath(`/proc/${process.pid}/fd/${pinned.handle.fd}`);
    } catch {
      throw new Error('Upload directory changed while uploading');
    }
    if (current !== pinned.canonicalPath) {
      throw new Error('Upload directory changed while uploading');
    }
  }
}

function safeHandleFromPinned(directory: PinnedDirectory): SafeUploadDirectoryHandle {
  return {
    handle: directory.handle,
    canonicalPath: directory.canonicalPath,
    accessPath: directory.accessPath,
    verify: () => verifyPinnedChain(directory),
    close: closeOnce([directory.handle, ...directory.guards.map((guard) => guard.handle)]),
  };
}

async function closePinnedChain(directory: PinnedDirectory): Promise<void> {
  await Promise.allSettled([
    directory.handle.close(),
    ...directory.guards.map((guard) => guard.handle.close()),
  ]);
}

function closeOnce(handles: FileHandle[]): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled(handles.map((handle) => handle.close()));
  };
}

function requireLinuxFdPaths(): void {
  if (process.platform !== 'linux') {
    throw new Error('Secure cookie uploads require Linux /proc fd paths');
  }
}

function assertDescendant(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Upload directory is outside the workspace');
  }
}

function assertSafeComponent(component: string): void {
  if (!component || component === '.' || component === '..' || component.includes(sep) || component.includes('\0')) {
    throw new Error('Invalid upload directory component');
  }
}

async function assertRealDirectoryTree(anchor: string, target: string): Promise<void> {
  const base = resolve(anchor);
  const destination = resolve(target);
  const rel = relative(base, destination);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Upload directory is outside the workspace');
  }

  const baseStat = await lstat(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error('Upload directory must not contain symbolic links');
  }
  let current = base;
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component);
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw new Error('Upload directory must not contain symbolic links');
    }
  }

  const canonicalBase = await realpath(base);
  const canonicalDestination = await realpath(destination);
  if (canonicalDestination !== resolve(canonicalBase, rel)) {
    throw new Error('Upload directory must not contain symbolic links');
  }
}

function boundedKey(value: string | undefined): string {
  if (!value) return '-';
  return value.slice(0, 256);
}

function encodeKey(...values: string[]): string {
  return values.map((value) => `${value.length}:${value}`).join('|');
}

function selectionBudget(rolling: Budget, key: string): SelectionBudget {
  const existing = rolling.selections.get(key);
  if (existing) return existing;
  const created = { files: 0, bytes: 0 };
  rolling.selections.set(key, created);
  return created;
}
