import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserRegistry, slugify } from '../users/registry.js';

function tempFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-users-'));
  return { file: join(dir, 'users.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('first login bootstraps an admin when no admin emails are configured', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file);
    assert.equal(reg.isAllowed({ email: 'a@x.com', openId: 'ou_a' }), true);
    const a = reg.upsertOnLogin({ openId: 'ou_a', email: 'a@x.com', name: 'Alice' });
    assert.equal(a.role, 'admin');
    // Second stranger is no longer allowed automatically.
    assert.equal(reg.isAllowed({ email: 'b@x.com', openId: 'ou_b' }), false);
  } finally {
    cleanup();
  }
});

test('admin emails are always allowed and become admins; others need the allowlist', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file, ['boss@x.com']);
    assert.equal(reg.isAllowed({ email: 'member@x.com', openId: 'ou_m' }), false);
    assert.equal(reg.isAllowed({ email: 'BOSS@X.com', openId: 'ou_boss' }), true);
    reg.addToAllowlist('member@x.com');
    assert.equal(reg.isAllowed({ email: 'member@x.com', openId: 'ou_m' }), true);
    const member = reg.upsertOnLogin({ openId: 'ou_m', email: 'member@x.com', name: 'Member' });
    assert.equal(member.role, 'user');
    const boss = reg.upsertOnLogin({ openId: 'ou_boss', email: 'boss@x.com', name: 'Boss' });
    assert.equal(boss.role, 'admin');
    reg.removeFromAllowlist('member@x.com');
    // Existing (not disabled) users keep access until disabled explicitly.
    assert.equal(reg.isAllowed({ email: 'member@x.com', openId: 'ou_m' }), true);
    reg.setDisabled('ou_m', true);
    assert.equal(reg.isAllowed({ email: 'member@x.com', openId: 'ou_m' }), false);
  } finally {
    cleanup();
  }
});

test('allowed email domains auto-approve the whole company without an allowlist', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file, ['boss@x.com'], ['flowgpt.com']);
    // Anyone on the domain is allowed, no allowlist entry needed.
    assert.equal(reg.isAllowed({ email: 'newhire@flowgpt.com', openId: 'ou_n' }), true);
    assert.equal(reg.isAllowed({ email: 'NEWHIRE@FlowGPT.com', openId: 'ou_n2' }), true);
    // Other domains still need the allowlist / admin path.
    assert.equal(reg.isAllowed({ email: 'guest@gmail.com', openId: 'ou_g' }), false);
    // Domain members default to the user role.
    const u = reg.upsertOnLogin({ openId: 'ou_n', email: 'newhire@flowgpt.com', name: 'New Hire' });
    assert.equal(u.role, 'user');
    // Disabling is a hard revoke: domain auto-approval cannot bring them back.
    reg.setDisabled('ou_n', true);
    assert.equal(reg.isAllowed({ email: 'newhire@flowgpt.com', openId: 'ou_n' }), false);
  } finally {
    cleanup();
  }
});

test('trust-all mode admits any Feishu account, even with no email field', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file, ['boss@x.com'], [], true);
    // Feishu did not return an email — internal-app OAuth success is enough.
    assert.equal(reg.isAllowed({ openId: 'ou_noemail' }), true);
    assert.equal(reg.isAllowed({ email: undefined, openId: 'ou_b86133' }), true);
    // disable still revokes hard.
    reg.upsertOnLogin({ openId: 'ou_noemail', name: 'No Email' });
    reg.setDisabled('ou_noemail', true);
    assert.equal(reg.isAllowed({ openId: 'ou_noemail' }), false);
  } finally {
    cleanup();
  }
});

test('allowlist can hold feishu open_ids for accounts without visible emails', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file, ['boss@x.com']);
    reg.addToAllowlist('ou_no_email');
    assert.equal(reg.isAllowed({ email: undefined, openId: 'ou_no_email' }), true);
    const u = reg.upsertOnLogin({ openId: 'ou_no_email', name: '小王' });
    assert.match(u.slug, /^u-/);
  } finally {
    cleanup();
  }
});

test('slugs derive from email local part and dedupe collisions', () => {
  const { file, cleanup } = tempFile();
  try {
    const reg = new UserRegistry(file, ['boss@x.com']);
    reg.addToAllowlist('li.wang@x.com');
    reg.addToAllowlist('li.wang@y.com');
    const a = reg.upsertOnLogin({ openId: 'ou_1', email: 'li.wang@x.com', name: 'One' });
    const b = reg.upsertOnLogin({ openId: 'ou_2', email: 'li.wang@y.com', name: 'Two' });
    assert.equal(a.slug, 'li-wang');
    assert.equal(b.slug, 'li-wang-2');
    // Reload from disk: persisted atomically with both users.
    const reloaded = new UserRegistry(file, []);
    assert.equal(reloaded.list().length, 2);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { users: unknown[] };
    assert.equal(raw.users.length, 2);
  } finally {
    cleanup();
  }
});

test('slugify strips unsafe characters', () => {
  assert.equal(slugify('Li.Wang+Test'), 'li-wang-test');
  assert.equal(slugify('---'), '');
  assert.equal(slugify('黑客@123'), '123');
});

test('multiple registry processes merge writes and refresh stale reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-users-multi-'));
  const file = join(dir, 'users.json');
  try {
    const first = new UserRegistry(file, ['boss@x.com']);
    const second = new UserRegistry(file, ['boss@x.com']);
    first.load();
    second.load();

    first.addToAllowlist('alice@x.com');
    first.upsertOnLogin({ openId: 'ou_alice', email: 'alice@x.com', name: 'Alice' });
    second.addToAllowlist('bob@x.com');
    second.upsertOnLogin({ openId: 'ou_bob', email: 'bob@x.com', name: 'Bob' });

    assert.deepEqual(first.allowlist().sort(), ['alice@x.com', 'bob@x.com']);
    assert.deepEqual(second.list().map((user) => user.openId).sort(), ['ou_alice', 'ou_bob']);

    first.setRole('ou_bob', 'admin');
    assert.equal(second.getByOpenId('ou_bob')?.role, 'admin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
