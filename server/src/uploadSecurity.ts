import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/**
 * Creates the private upload tree one component at a time. Existing symlinks
 * are rejected before and after mkdir, and realpath must remain anchored below
 * the caller-selected project root. This intentionally fails closed.
 */
export async function ensureSafeUploadDirectory(root: string, date: string, scopeRoot = root): Promise<string> {
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
