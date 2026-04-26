import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function fakeCodexScriptWithRealJson(dir: string): string {
  const path = join(dir, 'fake-codex-real.mjs');
  writeFileSync(path, [
    '#!/usr/bin/env node',
    'console.log(JSON.stringify({ type: "session_meta", payload: { id: "codex-real-thread", model: "gpt-5.5" } }));',
    'console.log(JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }));',
    'console.log(JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Working" } }));',
    'console.log(JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Working" }] } }));',
    'console.log(JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call_1", arguments: JSON.stringify({ cmd: "echo ok" }) } }));',
    'console.log(JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "ok\\\\n" } }));',
    'console.log(JSON.stringify({ type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done" } }));',
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
    const stateDeltas: any[] = [];
    s.subscribe((ev) => seen.push(ev.event));
    s.subscribeState((delta) => stateDeltas.push(delta));
    s.sendUser('hello');

    await waitFor(() => s.getState().runtimeStatus === 'idle' && seen.some((ev) => ev.type === 'result'));

    assert.equal(s.getState().provider, 'codex');
    assert.equal(s.getState().nodeId, 'macbook');
    assert.equal(s.getState().providerSessionId, 'codex-thread-1');
    assert.equal(s.getState().tokensIn, 2);
    assert.equal(s.getState().tokensOut, 3);
    assert.equal(s.getState().activeTool, undefined);
    assert.deepEqual(stateDeltas[0].activeTool, {
      toolUseId: 'codex_turn_2',
      name: 'Codex',
      startedAt: stateDeltas[0].activeTool.startedAt,
      inputSummary: 'hello',
    });
    assert.equal(typeof stateDeltas[0].activeTool.startedAt, 'number');
    assert.deepEqual(seen.map((ev) => ev.type), ['user', 'assistant', 'result']);
    assert.equal(seen[1].message.content[0].text, 'Codex OK');
    await s.close();
  } finally {
    if (prev === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CodexSession maps current codex exec --json events and dedupes mirrored messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-codex-real-test-'));
  const prev = process.env.CODEX_PATH;
  process.env.CODEX_PATH = fakeCodexScriptWithRealJson(dir);

  try {
    const s = new CodexSession({ id: 'codex-live-real', cwd: dir, nodeId: 'macbook' });
    const seen: any[] = [];
    s.subscribe((ev) => seen.push(ev.event));
    s.sendUser('hello');

    await waitFor(() => s.getState().runtimeStatus === 'idle' && seen.some((ev) => ev.type === 'result'));

    assert.equal(s.getState().providerSessionId, 'codex-real-thread');
    assert.equal(s.getState().model, 'gpt-5.5');
    assert.deepEqual(seen.map((ev) => ev.type), ['user', 'assistant', 'assistant', 'user', 'assistant', 'result']);
    assert.equal(seen[1].message.content[0].text, 'Working');
    assert.equal(seen[2].message.content[0].name, 'Bash');
    assert.equal(seen[2].message.content[0].input.command, 'echo ok');
    assert.equal(seen[3].message.content[0].tool_use_id, 'call_1');
    assert.equal(seen[4].message.content[0].text, 'Done');
    await s.close();
  } finally {
    if (prev === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CodexSession reloads prior codex transcript from CODEX_HOME on resume', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-codex-history-test-'));
  const prevHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  const historyDir = join(dir, 'sessions', '2026', '04', '26');
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(join(historyDir, 'rollout-2026-04-26T12-52-21-codex-history-thread.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-history-thread', model: 'gpt-5.5' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>ignored</environment_context>' }] } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'lost prompt' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'Recovered answer' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Recovered answer' }] } }),
  ].join('\n'));

  try {
    const s = new CodexSession({ id: 'codex-restored-live', cwd: dir, resume: 'codex-history-thread' });
    await s.historyReady;
    const events = s.replay().map((ev) => ev.event as any);

    assert.equal(s.getState().providerSessionId, 'codex-history-thread');
    assert.equal(s.getState().runtimeStatus, 'idle');
    assert.deepEqual(events.map((ev) => ev.type), ['user', 'assistant']);
    assert.equal(events[0].message.content, 'lost prompt');
    assert.equal(events[1].message.content[0].text, 'Recovered answer');
    await s.close();
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevHome;
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
