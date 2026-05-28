import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeClaudeProjectPath, loadClaudeTranscriptFast } from '../session/claudeTranscript.js';

test('encodeClaudeProjectPath mirrors Claude project transcript folders', () => {
  assert.equal(encodeClaudeProjectPath('/root'), '-root');
  assert.equal(encodeClaudeProjectPath('/root/random shit'), '-root-random shit');
});

test('loadClaudeTranscriptFast reads user and assistant messages from Claude jsonl', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-history-'));
  const sessionId = 'session-123';
  const dir = join(home, '.claude', 'projects', '-root');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'ignore me' }),
    JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    JSON.stringify({ type: 'custom-title', title: 'ignore me too' }),
    '',
  ].join('\n'));

  const messages = await loadClaudeTranscriptFast(sessionId, '/root', home);

  assert.equal(messages?.length, 2);
  assert.equal((messages?.[0] as any).type, 'user');
  assert.equal((messages?.[0] as any).parent_tool_use_id, null);
  assert.equal((messages?.[1] as any).type, 'assistant');
});

test('loadClaudeTranscriptFast falls back to scanning project dirs by session id', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-history-'));
  const sessionId = 'session-456';
  const dir = join(home, '.claude', 'projects', '-actual-project');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), JSON.stringify({
    type: 'user',
    uuid: 'u1',
    message: { role: 'user', content: 'found' },
  }));

  const messages = await loadClaudeTranscriptFast(sessionId, '/stale/cwd', home);

  assert.equal(messages?.length, 1);
  assert.equal((messages?.[0] as any).message.content, 'found');
});

test('loadClaudeTranscriptFast keeps plan_mode attachments so plan files can be displayed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccw-claude-history-'));
  const sessionId = 'session-plan';
  const dir = join(home, '.claude', 'projects', '-root');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), JSON.stringify({
    type: 'attachment',
    uuid: 'plan-attachment',
    attachment: {
      type: 'plan_mode',
      planExists: true,
      planFilePath: '/tmp/plan.md',
    },
  }));

  const messages = await loadClaudeTranscriptFast(sessionId, '/root', home);

  assert.equal(messages?.length, 1);
  assert.equal((messages?.[0] as any).type, 'attachment');
  assert.equal((messages?.[0] as any).attachment.type, 'plan_mode');
});
