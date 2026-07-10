import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signSession } from '../auth/cookie.js';
import type { CcwConfig } from '../config.js';
import {
  assertInScope,
  bindNewlyDiscoveredUserRoot,
  captureUserRootIdentity,
  captureFsRootIdentity,
  createIdentityContext,
  openScopedDirectory,
  resolveUser,
  type CcwUser,
} from '../users/identity.js';
import { UserRegistry } from '../users/registry.js';

const SECRET = 'test-cookie-secret-test-cookie-secret';

function scopedUser(root: string): CcwUser {
  return {
    openId: 'ou_alice',
    email: 'alice@example.com',
    name: 'Alice',
    slug: 'alice',
    role: 'user',
    isAdmin: false,
    via: 'cookie',
    workspaceRoot: root,
    fsRoot: root,
    canonicalFsRoot: realpathSync(root),
    canonicalFsRootIdentity: captureFsRootIdentity(realpathSync(root)),
  };
}

test('identity context canonicalizes a trusted configured root exactly once', () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-identity-config-'));
  const data = join(base, 'data');
  const alias = join(base, 'trusted-data-link');
  mkdirSync(join(data, 'users', 'alice'), { recursive: true });
  symlinkSync(data, alias);
  const config: CcwConfig = {
    authMode: 'feishu',
    cookieSecret: SECRET,
    cookieSecure: false,
    adminEmails: ['boss@example.com'],
    allowedEmailDomains: [],
    trustAllFeishu: false,
    feishu: { appId: 'app', appSecret: 'secret' },
    dataDir: alias,
    usersRoot: join(alias, 'users'),
    usersFile: join(alias, 'users.json'),
    templateDir: join(alias, 'template'),
    publicOrigin: 'https://claude.example.com',
  };
  const registry = new UserRegistry(config.usersFile, config.adminEmails);
  registry.addToAllowlist('alice@example.com');
  registry.upsertOnLogin({ openId: 'ou_alice', email: 'alice@example.com', name: 'Alice' });
  const context = createIdentityContext({ token: 'token', defaultCwd: alias, config, registry });
  const now = Math.floor(Date.now() / 1000);
  const cookie = `ccw_session=${encodeURIComponent(signSession({ sub: 'ou_alice', iat: now, exp: now + 60 }, SECRET))}`;

  try {
    const user = resolveUser({ headers: { cookie } }, context);
    assert.ok(user);
    assert.equal(context.canonicalDataRoot, realpathSync(data));
    assert.equal(user.canonicalFsRoot, realpathSync(join(data, 'users', 'alice')));
    assert.doesNotThrow(() => assertInScope(user, join(alias, 'users', 'alice')));

    renameSync(join(data, 'users', 'alice'), join(data, 'users', 'alice-original'));
    mkdirSync(join(data, 'users', 'alice'));
    assert.equal(resolveUser({ headers: { cookie } }, context), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('stable canonical root rejects replacing the workspace root itself with a symlink', () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-root-self-swap-'));
  const outside = mkdtempSync(join(tmpdir(), 'ccw-root-self-outside-'));
  const root = join(base, 'alice');
  const original = join(base, 'alice-original');
  mkdirSync(root);
  const user = scopedUser(root);

  try {
    renameSync(root, original);
    symlinkSync(outside, root);
    assert.throws(() => assertInScope(user, join(root, 'future.txt')), /outside your workspace/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('stable canonical root rejects an ancestor swapped to an external symlink', () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-root-ancestor-swap-'));
  const outside = mkdtempSync(join(tmpdir(), 'ccw-root-ancestor-outside-'));
  const users = join(base, 'users');
  const root = join(users, 'alice');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(outside, 'alice'), { recursive: true });
  const user = scopedUser(root);

  try {
    renameSync(users, join(base, 'users-original'));
    symlinkSync(outside, users);
    assert.throws(() => assertInScope(user, join(root, 'future.txt')), /outside your workspace/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('stable root identity rejects replacing alice with bob at the same real pathname', () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-root-inode-swap-'));
  const users = join(base, 'users');
  const alice = join(users, 'alice');
  const bob = join(users, 'bob');
  mkdirSync(alice, { recursive: true });
  mkdirSync(bob);
  writeFileSync(join(bob, 'secret.txt'), 'bob secret');
  const user = scopedUser(alice);

  try {
    renameSync(alice, join(users, 'alice-original'));
    renameSync(bob, alice);
    assert.throws(() => assertInScope(user, join(alice, 'secret.txt')), /outside your workspace/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('broken member roots stay unbound without taking down the identity context', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-broken-member-root-'));
  const usersRoot = join(dataDir, 'users');
  const outside = mkdtempSync(join(tmpdir(), 'ccw-broken-member-outside-'));
  mkdirSync(usersRoot);
  const config: CcwConfig = {
    authMode: 'feishu',
    cookieSecret: SECRET,
    cookieSecure: false,
    adminEmails: ['boss@example.com'],
    allowedEmailDomains: [],
    trustAllFeishu: false,
    feishu: { appId: 'app', appSecret: 'secret' },
    dataDir,
    usersRoot,
    usersFile: join(dataDir, 'users.json'),
    templateDir: join(dataDir, 'template'),
    publicOrigin: 'https://claude.example.com',
  };
  const registry = new UserRegistry(config.usersFile, config.adminEmails);
  for (const name of ['alice', 'charlie', 'bob']) {
    registry.addToAllowlist(`${name}@example.com`);
    registry.upsertOnLogin({ openId: `ou_${name}`, email: `${name}@example.com`, name });
  }
  symlinkSync(outside, join(usersRoot, 'alice'));
  writeFileSync(join(usersRoot, 'charlie'), 'not a directory');
  mkdirSync(join(usersRoot, 'bob'));

  try {
    const context = createIdentityContext({ token: 'token', defaultCwd: dataDir, config, registry });
    const now = Math.floor(Date.now() / 1000);
    const resolve = (openId: string) => resolveUser({
      headers: {
        cookie: `ccw_session=${encodeURIComponent(signSession({ sub: openId, iat: now, exp: now + 60 }, SECRET))}`,
      },
    }, context);
    assert.equal(resolve('ou_alice'), null);
    assert.equal(resolve('ou_charlie'), null);
    assert.ok(resolve('ou_bob'));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('fresh Linux identity context creates users root relative to the pinned data root', (t) => {
  if (process.platform !== 'linux') return t.skip('requires Linux /proc fd paths');
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-fresh-users-root-'));
  const config: CcwConfig = {
    authMode: 'feishu', cookieSecret: SECRET, cookieSecure: false,
    adminEmails: [], allowedEmailDomains: [], trustAllFeishu: false,
    feishu: { appId: 'app', appSecret: 'secret' }, dataDir,
    usersRoot: join(dataDir, 'users'), usersFile: join(dataDir, 'users.json'),
    templateDir: join(dataDir, 'template'), publicOrigin: 'https://claude.example.com',
  };
  try {
    const context = createIdentityContext({ token: 'token', defaultCwd: dataDir, config });
    assert.ok(context.canonicalUsersRootIdentity);
    assert.deepEqual(readdirSync(dataDir), ['users']);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Linux scoped close releases the final target and all ancestor guard fds', async (t) => {
  if (process.platform !== 'linux') return t.skip('requires Linux /proc fd paths');
  const root = mkdtempSync(join(tmpdir(), 'ccw-scoped-guards-'));
  const nested = join(root, 'one', 'two');
  mkdirSync(nested, { recursive: true });
  const user = scopedUser(root);
  const before = readdirSync(`/proc/${process.pid}/fd`).length;
  try {
    const opened = await openScopedDirectory(user, nested);
    assert.ok(readdirSync(`/proc/${process.pid}/fd`).length >= before + 3);
    await opened.close();
    assert.equal(readdirSync(`/proc/${process.pid}/fd`).length, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second release lazily binds a user provisioned after both contexts started', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ccw-cross-release-bind-'));
  const usersRoot = join(dataDir, 'users');
  mkdirSync(usersRoot);
  const config: CcwConfig = {
    authMode: 'feishu', cookieSecret: SECRET, cookieSecure: false,
    adminEmails: ['boss@example.com'], allowedEmailDomains: [], trustAllFeishu: false,
    feishu: { appId: 'app', appSecret: 'secret' }, dataDir, usersRoot,
    usersFile: join(dataDir, 'users.json'), templateDir: join(dataDir, 'template'),
    publicOrigin: 'https://claude.example.com',
  };
  const registryA = new UserRegistry(config.usersFile, config.adminEmails);
  const registryB = new UserRegistry(config.usersFile, config.adminEmails);
  const contextA = createIdentityContext({ token: 'token', defaultCwd: dataDir, config, registry: registryA });
  const contextB = createIdentityContext({ token: 'token', defaultCwd: dataDir, config, registry: registryB });
  try {
    registryA.addToAllowlist('alice@example.com');
    const alice = registryA.upsertOnLogin({ openId: 'ou_alice', email: 'alice@example.com', name: 'Alice' });
    mkdirSync(join(usersRoot, alice.slug));
    const first = captureUserRootIdentity(contextA, alice);
    const second = bindNewlyDiscoveredUserRoot(contextB, alice);
    assert.deepEqual(second, first);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cookie directory opens fail closed without Linux /proc fd paths', async (t) => {
  if (process.platform === 'linux') return t.skip('non-Linux fail-closed regression');
  const root = mkdtempSync(join(tmpdir(), 'ccw-cookie-dir-fd-'));
  const user = scopedUser(root);
  try {
    await assert.rejects(openScopedDirectory(user, root), /outside your workspace/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
