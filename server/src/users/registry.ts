import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type UserRole = 'admin' | 'user';

export type StoredUser = {
  openId: string;
  email: string;
  name: string;
  slug: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: number;
  lastLoginAt: number;
  disabled?: boolean;
};

type UsersFile = {
  version: 1;
  users: StoredUser[];
  /** Emails (case-insensitive) or Feishu open_ids allowed to log in. */
  allowlist: string[];
};

export type LoginInfo = {
  openId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
};

/**
 * File-backed user registry for feishu mode. All mutations rewrite users.json
 * atomically (tmp + rename, mode 0600). Reads go through an in-memory copy
 * that is reloaded lazily so manual edits on disk are picked up.
 */
export class UserRegistry {
  private data: UsersFile = { version: 1, users: [], allowlist: [] };
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly adminEmails: string[] = [],
    /** Email domains whose Feishu accounts are auto-approved (e.g. flowgpt.com).
     *  Lets the whole company in without collecting individual addresses. */
    private readonly allowedDomains: string[] = [],
    /** Trust any successful Feishu OAuth (internal app = company-bounded). */
    private readonly trustAllFeishu = false
  ) {}

  private domainAllowed(email: string | undefined): boolean {
    if (!email || this.allowedDomains.length === 0) return false;
    const domain = email.toLowerCase().split('@')[1];
    return !!domain && this.allowedDomains.includes(domain);
  }

  load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<UsersFile>;
      this.data = {
        version: 1,
        users: Array.isArray(parsed.users) ? (parsed.users as StoredUser[]) : [],
        allowlist: Array.isArray(parsed.allowlist) ? parsed.allowlist.map(String) : [],
      };
    } catch {
      this.data = { version: 1, users: [], allowlist: [] };
    }
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(this.file), `.users.json.tmp-${process.pid}`);
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  getByOpenId(openId: string): StoredUser | undefined {
    this.ensureLoaded();
    return this.data.users.find((u) => u.openId === openId);
  }

  list(): StoredUser[] {
    this.ensureLoaded();
    return [...this.data.users];
  }

  allowlist(): string[] {
    this.ensureLoaded();
    return [...this.data.allowlist];
  }

  isAdminEmail(email: string | undefined): boolean {
    return !!email && this.adminEmails.includes(email.toLowerCase());
  }

  /**
   * Whether this principal may log in. Admin emails are always allowed.
   * As a bootstrap, when there are no users yet and no admin emails are
   * configured, the very first login is allowed (and becomes admin).
   */
  isAllowed(info: { email?: string; openId: string }): boolean {
    this.ensureLoaded();
    const existing = this.getByOpenId(info.openId);
    // A disabled account is revoked — no domain/allowlist rule re-approves it.
    if (existing?.disabled) return false;
    if (this.isAdminEmail(info.email)) return true;
    // Internal-app trust: anyone who completed OAuth is a company member.
    if (this.trustAllFeishu) return true;
    if (this.domainAllowed(info.email)) return true;
    const email = info.email?.toLowerCase();
    for (const entry of this.data.allowlist) {
      const e = entry.toLowerCase();
      if (email && e === email) return true;
      if (entry === info.openId) return true;
    }
    if (existing) return true;
    if (this.data.users.length === 0 && this.adminEmails.length === 0) return true;
    return false;
  }

  upsertOnLogin(info: LoginInfo): StoredUser {
    this.ensureLoaded();
    const now = Date.now();
    let user = this.getByOpenId(info.openId);
    if (user) {
      user.lastLoginAt = now;
      if (info.email) user.email = info.email;
      if (info.name) user.name = info.name;
      if (info.avatarUrl) user.avatarUrl = info.avatarUrl;
      if (this.isAdminEmail(user.email)) user.role = 'admin';
      this.save();
      return user;
    }
    // Bootstrap-first-admin only applies when no admin emails are configured;
    // with CCW_ADMIN_EMAILS set, admins come exclusively from that list.
    const bootstrap = this.data.users.length === 0 && this.adminEmails.length === 0;
    user = {
      openId: info.openId,
      email: info.email ?? '',
      name: info.name || info.email || info.openId,
      slug: this.assignSlug(info.email, info.openId),
      role: bootstrap || this.isAdminEmail(info.email) ? 'admin' : 'user',
      avatarUrl: info.avatarUrl,
      createdAt: now,
      lastLoginAt: now,
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  addToAllowlist(entry: string): void {
    this.ensureLoaded();
    const value = entry.trim();
    if (!value) throw new Error('empty allowlist entry');
    if (!this.data.allowlist.some((e) => e.toLowerCase() === value.toLowerCase())) {
      this.data.allowlist.push(value);
      this.save();
    }
  }

  removeFromAllowlist(entry: string): void {
    this.ensureLoaded();
    const before = this.data.allowlist.length;
    this.data.allowlist = this.data.allowlist.filter((e) => e.toLowerCase() !== entry.toLowerCase());
    if (this.data.allowlist.length !== before) this.save();
  }

  setRole(openId: string, role: UserRole): StoredUser {
    this.ensureLoaded();
    const user = this.getByOpenId(openId);
    if (!user) throw new Error('user not found');
    user.role = role;
    this.save();
    return user;
  }

  setDisabled(openId: string, disabled: boolean): StoredUser {
    this.ensureLoaded();
    const user = this.getByOpenId(openId);
    if (!user) throw new Error('user not found');
    user.disabled = disabled;
    this.save();
    return user;
  }

  private assignSlug(email: string | undefined, openId: string): string {
    const base = slugify(email?.split('@')[0] ?? '') || `u-${openId.slice(-8).toLowerCase()}`;
    const taken = new Set(this.data.users.map((u) => u.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${openId.slice(-6).toLowerCase()}`;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}
