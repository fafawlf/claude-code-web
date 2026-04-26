import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../session/SessionManager.js';
import { ClaudeSession } from '../session/ClaudeSession.js';
import type { AgentProvider, AgentSession, AgentSessionOptions } from '../agents/types.js';

// We don't actually exercise Claude. Fresh sessions are lazy and don't spawn
// the SDK subprocess until the first user prompt, so these tests can focus on
// the SessionManager's registry behavior.

function makeOpts() {
  return {
    cwd: '/tmp',
    onPermission: () => {},
    onPlan: () => {},
  };
}

class FakeCodexProvider implements AgentProvider {
  readonly id = 'codex' as const;
  readonly label = 'Codex';
  createSession(opts: AgentSessionOptions): AgentSession {
    return new ClaudeSession({ ...opts, provider: this.id });
  }
}

test('attach and detach track subscribers correctly', async () => {
  const sm = new SessionManager();
  const s = sm.create(makeOpts());
  sm.attach(s.id);
  sm.attach(s.id);
  assert.equal(sm.getSnapshot(s.id)?.attachedCount, 2);

  // Reap should NOT remove a session with positive subscriber count.
  // We fill remaining slots, then confirm the first session is still present.
  for (let i = 0; i < 7; i++) sm.create(makeOpts());
  assert.equal(sm.get(s.id)?.isClosed(), false);

  sm.detach(s.id);
  sm.detach(s.id);
  assert.equal(sm.getSnapshot(s.id)?.attachedCount, 0);
  // Now zero subscribers — next create at cap will reap it.

  await sm.closeAll();
});

test('detaching a session does not close it; it remains attachable in the background', async () => {
  const sm = new SessionManager();
  const s = sm.create(makeOpts());
  sm.attach(s.id);
  sm.detach(s.id);

  assert.equal(sm.get(s.id)?.isClosed(), false);
  assert.equal(sm.getSnapshot(s.id)?.attachedCount, 0);

  sm.attach(s.id);
  assert.equal(sm.getSnapshot(s.id)?.attachedCount, 1);
  await sm.closeAll();
});

test('create over cap with abandoned sessions reaps and succeeds', async () => {
  const sm = new SessionManager();
  const sessions = [];
  for (let i = 0; i < 8; i++) sessions.push(sm.create(makeOpts()));
  // None are attached → all abandoned. The next create should reap.
  const later = sm.create(makeOpts());
  assert.ok(later, 'create should succeed by reaping an abandoned session');
  await sm.closeAll();
});

test('create over cap with ALL attached sessions throws', async () => {
  const sm = new SessionManager();
  for (let i = 0; i < 8; i++) {
    const s = sm.create(makeOpts());
    sm.attach(s.id);
  }
  assert.throws(() => sm.create(makeOpts()), /session limit/i);
  await sm.closeAll();
});

test('remove closes and forgets the session', async () => {
  const sm = new SessionManager();
  const s = sm.create(makeOpts());
  await sm.remove(s.id);
  assert.equal(sm.get(s.id), undefined);
});

test('provider registry dispatches session creation by provider id', async () => {
  const sm = new SessionManager([new FakeCodexProvider()]);
  const s = sm.create({ ...makeOpts(), provider: 'codex' });

  assert.equal(s.getState().provider, 'codex');
  await sm.closeAll();
});

test('provider registry reports unavailable providers', async () => {
  const sm = new SessionManager();

  assert.throws(() => sm.create({ ...makeOpts(), provider: 'codex' }), /provider codex is not available/i);
  await sm.closeAll();
});
