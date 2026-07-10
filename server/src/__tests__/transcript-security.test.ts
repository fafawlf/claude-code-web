import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodexSession } from '../agents/CodexSession.js';
import { findCodexSessionFile } from '../agents/codexTranscript.js';
import { encodeClaudeProjectPath, findClaudeTranscriptFile, streamClaudeTranscriptMessages } from '../session/claudeTranscript.js';

test('Codex transcript lookup verifies the exact session id instead of matching a short filename fragment', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-codex-transcript-security-'));
  const historyDir = join(home, 'sessions', '2026', '07', '10');
  const file = join(historyDir, 'rollout-2026-07-10T10-00-00-prefix-short.jsonl');
  await mkdir(historyDir, { recursive: true });
  await writeFile(file, `${JSON.stringify({
    type: 'session_meta',
    payload: { id: 'prefix-short', cwd: '/srv/ccw/users/alice/project' },
  })}\n`);

  try {
    assert.equal(await findCodexSessionFile('short', home), undefined);
    assert.equal(await findCodexSessionFile('prefix-short', home), file);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Codex transcript lookup never reuses an unscoped cache entry in another workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-codex-transcript-security-'));
  const historyDir = join(home, 'sessions', '2026', '07', '10');
  const file = join(historyDir, 'rollout-2026-07-10T10-00-00-bob-thread.jsonl');
  const aliceRoot = '/srv/ccw/users/alice';
  const bobRoot = '/srv/ccw/users/bob';
  await mkdir(historyDir, { recursive: true });
  await writeFile(file, `${JSON.stringify({
    type: 'session_meta',
    payload: { id: 'bob-thread', cwd: `${bobRoot}/project` },
  })}\n`);

  try {
    assert.equal(await findCodexSessionFile('bob-thread', home), file);
    assert.equal(
      await findCodexSessionFile('bob-thread', home, undefined, aliceRoot),
      undefined,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Codex transcript lookup allows an exact session inside the requested workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-codex-transcript-security-'));
  const historyDir = join(home, 'sessions', '2026', '07', '10');
  const file = join(historyDir, 'rollout-2026-07-10T10-00-00-alice-thread.jsonl');
  const aliceRoot = '/srv/ccw/users/alice';
  await mkdir(historyDir, { recursive: true });
  await writeFile(file, `${JSON.stringify({
    type: 'session_meta',
    payload: { id: 'alice-thread', cwd: `${aliceRoot}/project` },
  })}\n`);

  try {
    assert.equal(
      await findCodexSessionFile('alice-thread', home, undefined, aliceRoot),
      file,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('CodexSession carries its workspace scope into resume history lookup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-codex-transcript-security-'));
  const historyDir = join(home, 'sessions', '2026', '07', '10');
  const aliceRoot = '/srv/ccw/users/alice';
  const previousHome = process.env.CODEX_HOME;
  await mkdir(historyDir, { recursive: true });
  await writeFile(join(historyDir, 'rollout-2026-07-10T10-00-00-bob-thread-wired.jsonl'), [
    JSON.stringify({
      type: 'session_meta',
      payload: { id: 'bob-thread-wired', cwd: '/srv/ccw/users/bob/project' },
    }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'private' } }),
  ].join('\n'));

  process.env.CODEX_HOME = home;
  const session = new CodexSession({
    id: 'runtime-alice',
    cwd: `${aliceRoot}/project`,
    resume: 'bob-thread-wired',
    searchRoot: aliceRoot,
    viewerMode: true,
  });
  try {
    await session.historyReady;
    assert.deepEqual(session.replay(), []);
  } finally {
    await session.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test('Claude transcript lookup rejects traversal in resume ids before joining a path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-transcript-security-'));
  const projects = join(home, '.claude', 'projects');
  const escaped = join(projects, 'victim.jsonl');
  await mkdir(projects, { recursive: true });
  await writeFile(escaped, '{}\n');

  try {
    await assert.rejects(
      findClaudeTranscriptFile('../victim', '/srv/ccw/users/alice/project', home),
      /invalid transcript session id/i,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('scoped Claude lookup does not confuse alice with alice-2 encoded directories', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-transcript-security-'));
  const aliceRoot = '/srv/ccw/users/alice';
  const aliceCwd = `${aliceRoot}/project`;
  const alice2Cwd = '/srv/ccw/users/alice-2/project';
  const projects = join(home, '.claude', 'projects');
  const alice2File = join(projects, encodeClaudeProjectPath(alice2Cwd), 'shared-id.jsonl');
  await mkdir(join(projects, encodeClaudeProjectPath(alice2Cwd)), { recursive: true });
  await writeFile(alice2File, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'private' } })}\n`);

  try {
    assert.equal(
      await findClaudeTranscriptFile('shared-id', aliceCwd, home, aliceRoot),
      undefined,
    );
    const streamed: unknown[] = [];
    for await (const message of streamClaudeTranscriptMessages('shared-id', aliceCwd, { home, searchRoot: aliceRoot })) {
      streamed.push(message);
    }
    assert.deepEqual(streamed, [], 'scoped miss must not invoke the unbounded SDK fallback');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('scoped Claude lookup accepts only the exact direct transcript inside the workspace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-transcript-security-'));
  const aliceRoot = '/srv/ccw/users/alice';
  const aliceCwd = `${aliceRoot}/project`;
  const projects = join(home, '.claude', 'projects');
  const file = join(projects, encodeClaudeProjectPath(aliceCwd), 'alice-id.jsonl');
  await mkdir(join(projects, encodeClaudeProjectPath(aliceCwd)), { recursive: true });
  await writeFile(file, '{}\n');

  try {
    assert.equal(await findClaudeTranscriptFile('alice-id', aliceCwd, home, aliceRoot), file);
    assert.equal(
      await findClaudeTranscriptFile('alice-id', '/srv/ccw/users/alice-2/project', home, aliceRoot),
      undefined,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
