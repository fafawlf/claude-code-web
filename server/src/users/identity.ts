import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
};

export type IdentityContext = {
  token: string;
  defaultCwd: string;
  config: CcwConfig;
  registry?: UserRegistry;
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
  };
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
  if (!isPathInside(resolve(user.fsRoot), target)) throw new ScopeError();
}

/** Resolve a caller-supplied path against the user's anchor and enforce scope. */
export function resolveScoped(p: string, user: CcwUser): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(fsAnchor(user), p);
  assertInScope(user, abs);
  return abs;
}
