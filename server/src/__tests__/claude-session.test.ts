import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeSession } from '../session/ClaudeSession.js';

function stubs() {
  return { onPermission: () => false, onPlan: () => false };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('initial state: permissionMode defaults to default when not provided', () => {
  const s = new ClaudeSession({ id: 'id-1', cwd: '/tmp', ...stubs() });
  assert.equal(s.getState().permissionMode, 'default');
  assert.equal(s.getState().cwd, '/tmp');
  assert.equal(s.getState().sessionId, 'id-1');
  assert.equal(s.getState().nodeId, 'local');
  assert.equal(s.getState().provider, 'claude');
  assert.equal((s as any).query, undefined);
  void s.close();
});

test('initial state records explicit Claude auth mode', () => {
  const s = new ClaudeSession({ id: 'id-auth-mode', cwd: '/tmp', claudeAuthMode: 'api', ...stubs() });
  assert.equal(s.getState().claudeAuthMode, 'api');
  void s.close();
});

test('Claude API mode injects fallback key while account mode strips API env', async () => {
  const oldFallback = process.env.CCW_ANTHROPIC_API_KEY;
  const oldApi = process.env.ANTHROPIC_API_KEY;
  const oldToken = process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    process.env.CCW_ANTHROPIC_API_KEY = 'sk-fallback';
    process.env.ANTHROPIC_API_KEY = 'sk-active';
    process.env.ANTHROPIC_AUTH_TOKEN = 'oauth-token';

    const api = new ClaudeSession({ id: 'id-auth-api', cwd: '/tmp', claudeAuthMode: 'api', ...stubs() });
    const apiOptions = (api as any).buildOptions();
    assert.equal(apiOptions.env.ANTHROPIC_API_KEY, 'sk-fallback');
    assert.equal(apiOptions.env.CCW_ANTHROPIC_API_KEY, undefined);
    await api.close();

    const account = new ClaudeSession({ id: 'id-auth-account', cwd: '/tmp', claudeAuthMode: 'account', ...stubs() });
    const accountOptions = (account as any).buildOptions();
    assert.equal(accountOptions.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(accountOptions.env.ANTHROPIC_AUTH_TOKEN, undefined);
    await account.close();
  } finally {
    restoreEnv('CCW_ANTHROPIC_API_KEY', oldFallback);
    restoreEnv('ANTHROPIC_API_KEY', oldApi);
    restoreEnv('ANTHROPIC_AUTH_TOKEN', oldToken);
  }
});

test('fresh sessions do not spawn Claude Code until the first user message', () => {
  const s = new ClaudeSession({ id: 'id-lazy', cwd: '/tmp', ...stubs() });
  assert.equal((s as any).query, undefined);
  assert.equal(s.getState().lastEventId, 0);
  void s.close();
});

test('initial state: permissionMode = plan when passed', () => {
  const s = new ClaudeSession({ id: 'id-2', cwd: '/tmp', permissionMode: 'plan', ...stubs() });
  assert.equal(s.getState().permissionMode, 'plan');
  void s.close();
});

test('initial state: resume sets claudeSessionId before any event arrives', () => {
  const s = new ClaudeSession({
    id: 'id-3',
    cwd: '/tmp',
    resume: 'abc-claude-uuid',
    ...stubs(),
  });
  assert.equal(s.getState().claudeSessionId, 'abc-claude-uuid');
  void s.close();
});

test('resumed sessions load transcript without spawning Claude until user writes', async () => {
  const s = new ClaudeSession({
    id: 'id-resume-lazy',
    cwd: '/nonexistent-ccw-test',
    resume: 'does-not-exist-either',
    ...stubs(),
  });

  await s.historyReady;
  assert.equal((s as any).query, undefined);
  await s.close();
});

test('setPermissionMode before query is constructed updates state without throwing', async () => {
  // Using resume forces the history-load path where this.query starts undefined.
  // The SDK call to getSessionMessages will fail (no such session on disk),
  // but updateState should still reflect the user's intent.
  const s = new ClaudeSession({
    id: 'id-4',
    cwd: '/nonexistent-ccw-test',
    resume: 'does-not-exist-either',
    ...stubs(),
  });
  // Immediately, before history finishes resolving:
  await s.setPermissionMode('plan');
  assert.equal(s.getState().permissionMode, 'plan');
  await s.setModel('claude-opus-4-8');
  assert.equal(s.getState().model, 'claude-opus-4-8');
  await s.close();
});

test('state listeners fire with the delta on updateState', async () => {
  const s = new ClaudeSession({ id: 'id-5', cwd: '/tmp', ...stubs() });
  const deltas: any[] = [];
  s.subscribeState((d) => deltas.push(d));
  // setPermissionMode updates state synchronously BEFORE awaiting the SDK
  // control request; the CLI subprocess may still fail (no auth in test env),
  // so we swallow that — the listener should already have captured the delta.
  await s.setPermissionMode('acceptEdits').catch(() => {});
  assert.ok(deltas.some((d) => d.permissionMode === 'acceptEdits'));
  await s.close();
});

test('permission requests remain pending and are exposed for later attach', async () => {
  const s = new ClaudeSession({
    id: 'id-6',
    cwd: '/tmp',
    resume: 'missing-session',
    viewerMode: true,
    ...stubs(),
  });
  const seen: any[] = [];
  s.subscribeControls((c) => seen.push(c));

  const ac = new AbortController();
  const pending = s.permissionBroker.request('Bash', { command: 'pwd' }, { toolUseId: 'tu_1', signal: ac.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'permission');
  assert.equal(s.getPendingControls().length, 1);
  assert.equal(s.getState().runtimeStatus, 'waiting_permission');

  s.permissionBroker.resolve(seen[0].reqId, { decision: 'allow' });
  const result = await pending;
  assert.equal(result.behavior, 'allow');
  await s.close();
});

test('plan requests remain pending and are exposed for later attach', async () => {
  const s = new ClaudeSession({
    id: 'id-7',
    cwd: '/tmp',
    resume: 'missing-session',
    viewerMode: true,
    ...stubs(),
  });
  const seen: any[] = [];
  s.subscribeControls((c) => seen.push(c));

  const ac = new AbortController();
  const pending = s.planBroker.awaitApproval('do the safe plan', ac.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'plan');
  assert.equal(s.getPendingControls().length, 1);
  assert.equal(s.getState().runtimeStatus, 'waiting_plan');

  s.planBroker.resolve(seen[0].reqId, 'approve');
  const result = await pending;
  assert.equal(result.behavior, 'allow');
  await s.close();
});

test('active tool is exposed while a tool_use is awaiting its result', async () => {
  const s = new ClaudeSession({ id: 'id-tool', cwd: '/tmp', ...stubs() });
  (s as any).pushEvent({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tu_bash', name: 'Bash', input: { command: 'sleep 1' } }],
    },
  });

  assert.equal(s.getState().activeTool?.toolUseId, 'tu_bash');
  assert.equal(s.getState().activeTool?.name, 'Bash');
  assert.equal(s.getState().activeTool?.inputSummary, 'sleep 1');

  (s as any).pushEvent({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'tu_bash', content: 'ok' }],
    },
  });
  assert.equal(s.getState().activeTool, undefined);
  await s.close();
});

test('plan mode attachment is surfaced as readable assistant text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-plan-file-'));
  const planPath = join(dir, 'plan.md');
  await writeFile(planPath, '# Plan\n\nThis is the plan.');
  const s = new ClaudeSession({ id: 'id-plan-file', cwd: '/tmp', ...stubs() });

  await (s as any).pushTranscriptMessage({
    type: 'attachment',
    uuid: 'plan-attachment',
    attachment: {
      type: 'plan_mode',
      planExists: true,
      planFilePath: planPath,
    },
  });

  const assistant = s.replay().map((e) => e.event as any).find((e) => e.type === 'assistant');
  assert.equal(assistant.message.content[0].text, '# Plan\n\nThis is the plan.');
  await s.close();
});
