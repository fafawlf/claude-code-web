import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  assertFsRootIdentity,
  sameFsRootIdentity,
  type FsRootIdentity,
} from '../users/identity.js';

/**
 * A process-lifetime capability for one execution directory.
 *
 * Linux keeps both the authorization root and cwd open. Child processes use
 * the cwd fd via procfs, so replacing the user-visible pathname cannot redirect
 * execution after the session has been authorized.
 */
export interface WorkspaceLease {
  readonly cwd: string;
  readonly canonicalFsRoot: string;
  readonly canonicalFsRootIdentity: FsRootIdentity;
  readonly spawnCwd: string;
  assertWithin(allowedCanonicalFsRoot?: string, allowedRootIdentity?: FsRootIdentity): void;
  close(): void;
}

export class WorkspaceLeaseError extends Error {
  constructor(message = 'Execution workspace is no longer safe') {
    super(message);
    this.name = 'WorkspaceLeaseError';
  }
}

export class ExecutionWorkspace implements WorkspaceLease {
  readonly cwd: string;
  readonly canonicalFsRoot: string;
  readonly canonicalFsRootIdentity: FsRootIdentity;
  readonly spawnCwd: string;

  private readonly rootFd: number;
  private readonly cwdFd: number;
  private readonly rootIdentity: FileIdentity;
  private readonly cwdIdentity: FileIdentity;
  private closed = false;

  private constructor(opts: {
    cwd: string;
    canonicalFsRoot: string;
    canonicalFsRootIdentity: FsRootIdentity;
    rootFd: number;
    cwdFd: number;
    rootIdentity: FileIdentity;
    cwdIdentity: FileIdentity;
  }) {
    this.cwd = opts.cwd;
    this.canonicalFsRoot = opts.canonicalFsRoot;
    this.canonicalFsRootIdentity = opts.canonicalFsRootIdentity;
    this.rootFd = opts.rootFd;
    this.cwdFd = opts.cwdFd;
    this.rootIdentity = opts.rootIdentity;
    this.cwdIdentity = opts.cwdIdentity;
    this.spawnCwd = procFdPath(this.cwdFd);
  }

  /**
   * Pin a cookie-authenticated execution directory. This is intentionally
   * Linux-only: other platforms do not provide the procfs directory-fd path
   * that the child process needs, so scoped multi-user execution fails closed.
   */
  static pin(
    cwd: string,
    canonicalFsRoot: string,
    canonicalFsRootIdentity: FsRootIdentity | null,
  ): ExecutionWorkspace {
    if (process.platform !== 'linux') {
      throw new WorkspaceLeaseError('Cookie-authenticated execution requires Linux directory-fd isolation');
    }
    if (!canonicalFsRoot || !canonicalFsRootIdentity) {
      throw new WorkspaceLeaseError('Missing canonical filesystem root identity');
    }

    const stableRoot = resolve(canonicalFsRoot);
    const canonicalCwd = realpathDirectory(cwd);
    if (!isPathInside(stableRoot, canonicalCwd)) throw new WorkspaceLeaseError();

    let rootFd: number | undefined;
    let cwdFd: number | undefined;
    try {
      rootFd = openDirectory(stableRoot);
      cwdFd = openDirectory(canonicalCwd);
      const rootIdentity = identity(fstatSync(rootFd));
      const cwdIdentity = identity(fstatSync(cwdFd));
      if (!rootIdentity.directory || !cwdIdentity.directory) throw new WorkspaceLeaseError();
      if (!sameFsRootIdentity(rootIdentity, canonicalFsRootIdentity)) {
        throw new WorkspaceLeaseError('Execution workspace root identity changed');
      }

      const lease = new ExecutionWorkspace({
        cwd: resolve(cwd),
        canonicalFsRoot: stableRoot,
        canonicalFsRootIdentity,
        rootFd,
        cwdFd,
        rootIdentity,
        cwdIdentity,
      });
      // Verify the inodes reached through the opened descriptors rather than
      // trusting the pathname checks performed before open().
      lease.assertWithin(stableRoot, canonicalFsRootIdentity);
      return lease;
    } catch (error) {
      if (cwdFd !== undefined) closeBestEffort(cwdFd);
      if (rootFd !== undefined) closeBestEffort(rootFd);
      if (error instanceof WorkspaceLeaseError) throw error;
      throw new WorkspaceLeaseError();
    }
  }

  /**
   * Revalidate the pinned inodes and their location. `allowedCanonicalFsRoot`
   * is the current caller's stable authorization root; admins may therefore
   * attach to a user's narrower lease while ordinary users cannot.
   */
  assertWithin(
    allowedCanonicalFsRoot = this.canonicalFsRoot,
    allowedRootIdentity = this.canonicalFsRootIdentity,
  ): void {
    if (this.closed) throw new WorkspaceLeaseError('Execution workspace lease is closed');
    if (!allowedCanonicalFsRoot || !allowedRootIdentity) {
      throw new WorkspaceLeaseError('Missing canonical filesystem root identity');
    }

    try {
      assertSameIdentity(this.rootIdentity, fstatSync(this.rootFd));
      assertSameIdentity(this.cwdIdentity, fstatSync(this.cwdFd));
      if (!sameFsRootIdentity(this.rootIdentity, this.canonicalFsRootIdentity)) {
        throw new WorkspaceLeaseError();
      }
      assertFsRootIdentity(this.canonicalFsRoot, this.canonicalFsRootIdentity);

      const currentRoot = realpathSync(procFdPath(this.rootFd));
      const currentCwd = realpathSync(this.spawnCwd);
      // The root itself is part of the capability. Replacing or moving it
      // invalidates every lease created beneath it.
      if (resolve(currentRoot) !== this.canonicalFsRoot) throw new WorkspaceLeaseError();
      if (!isPathInside(this.canonicalFsRoot, resolve(currentCwd))) throw new WorkspaceLeaseError();

      const callerRoot = resolve(allowedCanonicalFsRoot);
      assertFsRootIdentity(callerRoot, allowedRootIdentity);
      if (!isPathInside(callerRoot, this.canonicalFsRoot)) throw new WorkspaceLeaseError();
    } catch (error) {
      if (error instanceof WorkspaceLeaseError) throw error;
      throw new WorkspaceLeaseError();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeBestEffort(this.cwdFd);
    closeBestEffort(this.rootFd);
  }
}

type FileIdentity = {
  dev: bigint;
  ino: bigint;
  directory: boolean;
};

function identity(stat: Stats): FileIdentity {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    directory: stat.isDirectory(),
  };
}

function assertSameIdentity(expected: FileIdentity, actualStat: Stats): void {
  const actual = identity(actualStat);
  if (!actual.directory || actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new WorkspaceLeaseError();
  }
}

function openDirectory(path: string): number {
  const directory = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  return openSync(path, constants.O_RDONLY | directory | noFollow);
}

function realpathDirectory(path: string): string {
  const canonical = realpathSync(resolve(path));
  const stat = statSync(canonical);
  if (!stat.isDirectory()) throw new WorkspaceLeaseError('Execution cwd is not a directory');
  return canonical;
}

function procFdPath(fd: number): string {
  return `/proc/${process.pid}/fd/${fd}`;
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function closeBestEffort(fd: number): void {
  try { closeSync(fd); } catch { /* idempotent/best effort */ }
}
