import { constants } from 'node:fs';
import { cp, mkdir, open, readdir, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { sameFsRootIdentity, type FsRootIdentity } from './identity.js';

export type ProvisionWorkspaceSecurity = {
  canonicalUsersRoot: string;
  canonicalUsersRootIdentity: FsRootIdentity;
  expectedWorkspaceIdentity?: FsRootIdentity;
  onPinnedIdentity?: (identity: FsRootIdentity) => void;
};

/**
 * Create/open one member root relative to a pinned users-root fd before any
 * copy or write. An existing unbound directory is rejected: accepting it would
 * let a workspace process pre-place another member's inode under a new slug.
 */
export async function provisionWorkspace(
  slug: string,
  templateDir: string | undefined,
  security: ProvisionWorkspaceSecurity,
): Promise<FsRootIdentity> {
  if (process.platform !== 'linux') {
    throw new Error('Workspace provisioning requires Linux /proc fd paths');
  }
  if (!slug || slug === '.' || slug === '..' || slug.includes(sep)) {
    throw new Error('Invalid workspace slug');
  }

  const root = resolve(security.canonicalUsersRoot);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const directory = typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0;
  let usersHandle: FileHandle | undefined;
  let workspaceHandle: FileHandle | undefined;
  try {
    usersHandle = await open(root, constants.O_RDONLY | noFollow | directory);
    const usersStat = await usersHandle.stat({ bigint: true });
    if (
      !sameFsRootIdentity({ dev: usersStat.dev, ino: usersStat.ino }, security.canonicalUsersRootIdentity)
      || await realpathFd(usersHandle) !== root
    ) {
      throw new Error('Users root identity changed');
    }

    const workspaceAccess = `/proc/${process.pid}/fd/${usersHandle.fd}/${slug}`;
    let created = false;
    try {
      await mkdir(workspaceAccess, { mode: 0o700 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!security.expectedWorkspaceIdentity) {
        throw new Error('Refusing an existing unbound workspace root');
      }
    }
    if (created && security.expectedWorkspaceIdentity) {
      throw new Error('Bound workspace root unexpectedly disappeared');
    }

    workspaceHandle = await open(workspaceAccess, constants.O_RDONLY | noFollow | directory);
    const workspaceStat = await workspaceHandle.stat({ bigint: true });
    const workspaceIdentity = { dev: workspaceStat.dev, ino: workspaceStat.ino };
    if (
      security.expectedWorkspaceIdentity
      && !sameFsRootIdentity(workspaceIdentity, security.expectedWorkspaceIdentity)
    ) {
      throw new Error('Workspace root identity changed');
    }
    const expectedWorkspace = join(root, slug);
    if (await realpathFd(workspaceHandle) !== expectedWorkspace) {
      throw new Error('Workspace root moved outside the users root');
    }
    // Bind the capability before template/starter writes. If initialization
    // fails, a retry recognizes this same inode instead of treating the
    // recoverable half-initialized directory as an attacker-precreated root.
    security.onPinnedIdentity?.(workspaceIdentity);

    const accessPath = `/proc/${process.pid}/fd/${workspaceHandle.fd}`;
    const entries = await readdir(accessPath);
    if (entries.length > 0) {
      await verifyStillPinned(usersHandle, workspaceHandle, root, expectedWorkspace, security);
      return workspaceIdentity;
    }

    if (templateDir) {
      try {
        const templateStat = await stat(templateDir);
        if (!templateStat.isDirectory()) throw new Error('Workspace template is not a directory');
        // Node's fs.cp treats the /proc fd symlink itself as a non-directory
        // when the source is a directory. Copy each child beneath the pinned
        // handle instead, so every write stays capability-scoped without
        // asking cp to replace the handle path.
        for (const entry of await readdir(templateDir)) {
          await cp(join(templateDir, entry), join(accessPath, entry), { recursive: true });
        }
        await verifyStillPinned(usersHandle, workspaceHandle, root, expectedWorkspace, security);
        return workspaceIdentity;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const starter = [
      '# My workspace',
      '',
      'This folder is your personal Claude Code workspace. Create one folder per',
      'project. Skills you put in `<project>/.claude/skills/` are yours alone;',
      'shared team context lives in the parent directories.',
      '',
    ].join('\n');
    await writeFile(join(accessPath, 'CLAUDE.md'), starter, { flag: 'wx' });
    await verifyStillPinned(usersHandle, workspaceHandle, root, expectedWorkspace, security);
    return workspaceIdentity;
  } finally {
    await workspaceHandle?.close().catch(() => undefined);
    await usersHandle?.close().catch(() => undefined);
  }
}

async function realpathFd(handle: FileHandle): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(`/proc/${process.pid}/fd/${handle.fd}`);
}

async function verifyStillPinned(
  usersHandle: FileHandle,
  workspaceHandle: FileHandle,
  root: string,
  workspace: string,
  security: ProvisionWorkspaceSecurity,
): Promise<void> {
  const usersStat = await usersHandle.stat({ bigint: true });
  if (
    !sameFsRootIdentity({ dev: usersStat.dev, ino: usersStat.ino }, security.canonicalUsersRootIdentity)
    || await realpathFd(usersHandle) !== root
    || await realpathFd(workspaceHandle) !== workspace
  ) {
    throw new Error('Workspace provisioning root changed');
  }
}
