import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearPerUserUsageCache, getPerUserUsage } from '../usage/localUsage.js';

function assistantLine(input: number, output: number, cacheRead = 0): string {
  return JSON.stringify({
    type: 'assistant',
    message: { usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead } },
  });
}

test('per-user usage aggregates assistant token counts from workspace transcripts', async () => {
  clearPerUserUsageCache();
  const projectsDir = mkdtempSync(join(tmpdir(), 'ccw-usage-'));
  const usersRoot = '/srv/ccw/users';
  const aliceProj = join(projectsDir, '-srv-ccw-users-alice-proj');
  const bobProj = join(projectsDir, '-srv-ccw-users-bob-demo');
  const unrelated = join(projectsDir, '-root-other-project');
  mkdirSync(aliceProj, { recursive: true });
  mkdirSync(bobProj, { recursive: true });
  mkdirSync(unrelated, { recursive: true });

  writeFileSync(join(aliceProj, 'a1.jsonl'), [
    assistantLine(100, 50, 10),
    JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    assistantLine(200, 75),
    'not json at all',
  ].join('\n'));
  writeFileSync(join(bobProj, 'b1.jsonl'), assistantLine(10, 5) + '\n');
  writeFileSync(join(unrelated, 'x.jsonl'), assistantLine(9999, 9999) + '\n');

  try {
    const usage = await getPerUserUsage(usersRoot, ['alice', 'bob'], { projectsDir });
    const alice = usage.find((u) => u.slug === 'alice')!;
    const bob = usage.find((u) => u.slug === 'bob')!;
    assert.equal(alice.tokensIn, 300);
    assert.equal(alice.tokensOut, 125);
    assert.equal(alice.cacheRead, 10);
    assert.equal(alice.sessions, 1);
    assert.equal(bob.tokensIn, 10);
    assert.equal(bob.tokensOut, 5);
    // The unrelated project is attributed to nobody.
    assert.equal(usage.reduce((sum, u) => sum + u.tokensIn, 0), 310);
  } finally {
    clearPerUserUsageCache();
    rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('longest slug prefix wins so "li" never swallows "li-wang"', async () => {
  clearPerUserUsageCache();
  const projectsDir = mkdtempSync(join(tmpdir(), 'ccw-usage-'));
  const usersRoot = '/srv/ccw/users';
  const liWang = join(projectsDir, '-srv-ccw-users-li-wang-proj');
  mkdirSync(liWang, { recursive: true });
  writeFileSync(join(liWang, 's.jsonl'), assistantLine(40, 20) + '\n');

  try {
    const usage = await getPerUserUsage(usersRoot, ['li', 'li-wang'], { projectsDir });
    assert.equal(usage.find((u) => u.slug === 'li-wang')!.tokensIn, 40);
    assert.equal(usage.find((u) => u.slug === 'li')!.tokensIn, 0);
  } finally {
    clearPerUserUsageCache();
    rmSync(projectsDir, { recursive: true, force: true });
  }
});
