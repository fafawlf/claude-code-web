import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureFsRootIdentity, type FsRootIdentity } from '../users/identity.js';
import { provisionWorkspace } from '../users/provision.js';

test('Linux provisioning rejects a pre-existing symlink before copying or writing', {
  skip: process.platform !== 'linux',
}, async () => {
  const data = mkdtempSync(join(tmpdir(), 'ccw-provision-link-'));
  const users = join(data, 'users');
  const outside = mkdtempSync(join(tmpdir(), 'ccw-provision-outside-'));
  mkdirSync(users);
  symlinkSync(outside, join(users, 'alice'));
  try {
    await assert.rejects(provisionWorkspace('alice', undefined, {
      canonicalUsersRoot: users,
      canonicalUsersRootIdentity: captureFsRootIdentity(users),
    }), /unbound|symbolic|loop|workspace/i);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('failed initialization binds the new inode early so a retry can recover safely', {
  skip: process.platform !== 'linux',
}, async () => {
  const data = mkdtempSync(join(tmpdir(), 'ccw-provision-retry-'));
  const users = join(data, 'users');
  const badTemplate = join(data, 'not-a-template');
  mkdirSync(users);
  writeFileSync(badTemplate, 'not a directory');
  let bound: FsRootIdentity | undefined;
  const base = {
    canonicalUsersRoot: users,
    canonicalUsersRootIdentity: captureFsRootIdentity(users),
  };
  try {
    await assert.rejects(provisionWorkspace('alice', badTemplate, {
      ...base,
      onPinnedIdentity: (identity) => { bound = identity; },
    }), /template is not a directory/i);
    assert.ok(bound);

    await provisionWorkspace('alice', undefined, {
      ...base,
      expectedWorkspaceIdentity: bound,
    });
    assert.match(readFileSync(join(users, 'alice', 'CLAUDE.md'), 'utf8'), /My workspace/);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
