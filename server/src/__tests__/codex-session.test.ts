import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexSession } from '../agents/CodexSession.js';

function fakeCodexScript(dir: string): string {
  const path = join(dir, 'fake-codex.mjs');
  writeFileSync(path, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    'const resumeIdx = args.indexOf("resume");',
    'const thread = resumeIdx >= 0 ? args[resumeIdx + 1] : "codex-thread-1";',
    'console.log(JSON.stringify({ type: "thread.started", thread_id: thread }));',
    'console.log(JSON.stringify({ type: "turn.started" }));',
    'console.log(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Codex OK" } }));',
    'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 3 } }));',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

test('CodexSession maps codex exec JSONL into chat-compatible events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-codex-test-'));
  const prev = process.env.CODEX_PATH;
  process.env.CODEX_PATH = fakeCodexScript(dir);

  try {
    const s = new CodexSession({ id: 'codex-live-1', cwd: dir, nodeId: 'macbook' });
    const seen: any[] = [];
    s.subscribe((ev) => seen.push(ev.event));
    s.sendUser('hello');

    await waitFor(() => s.getState().runtimeStatus === 'idle' && seen.some((ev) => ev.type === 'result'));

    assert.equal(s.getState().provider, 'codex');
    assert.equal(s.getState().nodeId, 'macbook');
    assert.equal(s.getState().providerSessionId, 'codex-thread-1');
    assert.equal(s.getState().tokensIn, 2);
    assert.equal(s.getState().tokensOut, 3);
    assert.deepEqual(seen.map((ev) => ev.type), ['user', 'assistant', 'result']);
    assert.equal(seen[1].message.content[0].text, 'Codex OK');
    await s.close();
  } finally {
    if (prev === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for predicate');
}
