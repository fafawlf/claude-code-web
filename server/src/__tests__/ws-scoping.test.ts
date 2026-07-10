import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../session/SessionManager.js';
import { resolveHelloSession } from '../ws.js';
import type { CcwUser } from '../users/identity.js';
import { findClaudeTranscriptFile } from '../session/claudeTranscript.js';

function userFor(slug: string, root: string, role: 'admin' | 'user' = 'user'): CcwUser {
  return {
    openId: `ou_${slug}`,
    email: `${slug}@x.com`,
    name: slug,
    slug,
    role,
    isAdmin: role === 'admin',
    via: 'cookie',
    workspaceRoot: root,
    fsRoot: root,
  };
}

test('hello: new sessions default to the user workspace and reject escapes', async () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-ws-'));
  const aliceRoot = join(base, 'users', 'alice');
  mkdirSync(aliceRoot, { recursive: true });
  const alice = userFor('alice', aliceRoot);
  const sm = new SessionManager();
  try {
    const resolved = resolveHelloSession(sm, { type: 'hello' }, base, undefined, alice);
    assert.equal(resolved.session.getState().cwd, aliceRoot);

    assert.throws(
      () => resolveHelloSession(sm, { type: 'hello', cwd: '/etc' }, base, undefined, alice),
      /outside your workspace/i
    );
    assert.throws(
      () => resolveHelloSession(sm, { type: 'hello', cwd: join(aliceRoot, '..', 'bob') }, base, undefined, alice),
      /outside your workspace/i
    );
  } finally {
    await sm.closeAll();
    rmSync(base, { recursive: true, force: true });
  }
});

test('hello: attaching someone else\'s live session looks like a missing session', async () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-ws-'));
  const aliceRoot = join(base, 'users', 'alice');
  const bobRoot = join(base, 'users', 'bob');
  mkdirSync(aliceRoot, { recursive: true });
  mkdirSync(bobRoot, { recursive: true });
  const alice = userFor('alice', aliceRoot);
  const bob = userFor('bob', bobRoot);
  const admin = userFor('boss', join(base), 'admin');
  const sm = new SessionManager();
  try {
    const owned = resolveHelloSession(sm, { type: 'hello' }, base, undefined, alice);

    // Bob asks for Alice's live session id: treated as not-found, and since the
    // fallback path would create a session in Bob's own workspace, the cwd must
    // be Bob's, not Alice's.
    const bobView = resolveHelloSession(sm, { type: 'hello', sessionId: owned.session.id }, base, undefined, bob);
    assert.notEqual(bobView.session.id, owned.session.id);
    assert.equal(bobView.session.getState().cwd, bobRoot);

    // Admins may attach for oversight.
    const adminView = resolveHelloSession(sm, { type: 'hello', sessionId: owned.session.id }, base, undefined, admin);
    assert.equal(adminView.session.id, owned.session.id);
  } finally {
    await sm.closeAll();
    rmSync(base, { recursive: true, force: true });
  }
});

test('resume reuse never crosses owners even with the same claude session id', async () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-ws-'));
  const aliceRoot = join(base, 'users', 'alice');
  const bobRoot = join(base, 'users', 'bob');
  mkdirSync(aliceRoot, { recursive: true });
  mkdirSync(bobRoot, { recursive: true });
  const alice = userFor('alice', aliceRoot);
  const bob = userFor('bob', bobRoot);
  const sm = new SessionManager();
  try {
    const first = resolveHelloSession(
      sm,
      { type: 'hello', resumeClaudeId: 'shared-claude-id', viewerMode: true },
      base,
      undefined,
      alice
    );
    const bobAttempt = resolveHelloSession(
      sm,
      { type: 'hello', resumeClaudeId: 'shared-claude-id', viewerMode: true },
      base,
      undefined,
      bob
    );
    assert.notEqual(bobAttempt.session.id, first.session.id);
    assert.equal(bobAttempt.session.getState().cwd, bobRoot);
  } finally {
    await sm.closeAll();
    rmSync(base, { recursive: true, force: true });
  }
});

test('per-owner session caps apply while attached sessions stay protected', async () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-ws-'));
  const aliceRoot = join(base, 'users', 'alice');
  mkdirSync(aliceRoot, { recursive: true });
  const sm = new SessionManager(undefined, { global: 24, perOwner: 2 });
  try {
    const s1 = sm.create({ cwd: aliceRoot, owner: 'ou_alice' });
    const s2 = sm.create({ cwd: aliceRoot, owner: 'ou_alice' });
    sm.attach(s1.id);
    sm.attach(s2.id);
    assert.throws(() => sm.create({ cwd: aliceRoot, owner: 'ou_alice' }), /sessions running/i);
    // Another owner is unaffected by Alice's cap.
    const other = sm.create({ cwd: aliceRoot, owner: 'ou_bob' });
    assert.ok(other.id);
  } finally {
    await sm.closeAll();
    rmSync(base, { recursive: true, force: true });
  }
});

test('transcript lookup with a search root never resolves another workspace\'s transcript', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ccw-home-'));
  const usersRoot = '/srv/ccw/users';
  const aliceCwd = `${usersRoot}/alice/proj`;
  const bobCwd = `${usersRoot}/bob/proj`;
  const projects = join(home, '.claude', 'projects');
  const aliceDir = join(projects, aliceCwd.replace(/\//g, '-'));
  const bobDir = join(projects, bobCwd.replace(/\//g, '-'));
  mkdirSync(aliceDir, { recursive: true });
  mkdirSync(bobDir, { recursive: true });
  writeFileSync(join(aliceDir, 'sess-a.jsonl'), '{}\n');
  writeFileSync(join(bobDir, 'sess-b.jsonl'), '{}\n');
  try {
    // Bob knows Alice's session UUID but his search root is his own workspace.
    const stolen = await findClaudeTranscriptFile('sess-a', bobCwd, home, `${usersRoot}/bob`);
    assert.equal(stolen, undefined);
    // Scoped production lookup is exact: a sibling project must not trigger
    // the lossy encoded-directory scan, even within the same workspace.
    const own = await findClaudeTranscriptFile('sess-a', `${usersRoot}/alice/other`, home, `${usersRoot}/alice`);
    assert.equal(own, undefined);
    const exact = await findClaudeTranscriptFile('sess-a', aliceCwd, home, `${usersRoot}/alice`);
    assert.equal(exact, join(aliceDir, 'sess-a.jsonl'));
    // Legacy mode without a search root still scans everything.
    const legacy = await findClaudeTranscriptFile('sess-b', aliceCwd, home);
    assert.equal(legacy, join(bobDir, 'sess-b.jsonl'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
