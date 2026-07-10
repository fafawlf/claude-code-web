import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { ClaudeSession } from '../session/ClaudeSession.js';
import { CodexSession } from '../agents/CodexSession.js';

test('resumed Claude prompts wait for history before constructing a live query', async () => {
  const session = new ClaudeSession({
    id: 'queued-claude',
    cwd: '/nonexistent-ccw-history-queue',
    resume: 'missing-queued-session',
  });
  const delivered: string[] = [];
  (session as any).sendUserAfterHistory = (text: string) => { delivered.push(text); };

  session.sendUser('continue after history');
  assert.ok((session as any).query === undefined, 'live query started before history settled');

  await session.historyReady;
  assert.notEqual((session as any).getHistoryMetadata().status, 'loading');
  assert.deepEqual(delivered, ['continue after history']);
  await session.close();
});

test('resumed Codex prompts do not spawn until history settles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-codex-queued-'));
  const previousHome = process.env.CODEX_HOME;
  const previousPath = process.env.CODEX_PATH;
  const previousMarker = process.env.CCW_TEST_CODEX_MARKER;
  const marker = join(dir, 'spawned');
  try {
    process.env.CODEX_HOME = dir;
    process.env.CCW_TEST_CODEX_MARKER = marker;
    const historyDir = join(dir, 'sessions', '2026', '07', '10');
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(historyDir, 'rollout-queued-codex-thread.jsonl'), [
      JSON.stringify({ type: 'session_meta', payload: { id: 'queued-codex-thread' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'old answer' } }),
    ].join('\n'));
    const fake = join(dir, 'fake-codex.mjs');
    await writeFile(fake, [
      '#!/usr/bin/env node',
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.CCW_TEST_CODEX_MARKER, "spawned");',
      'console.log(JSON.stringify({ type: "thread.started", thread_id: "queued-codex-thread" }));',
      'console.log(JSON.stringify({ type: "turn.completed", usage: {} }));',
    ].join('\n'));
    await chmod(fake, 0o755);
    process.env.CODEX_PATH = fake;

    const session = new CodexSession({ id: 'queued-codex', cwd: dir, resume: 'queued-codex-thread' });
    session.sendUser('new prompt');
    assert.equal(existsSync(marker), false);

    await session.historyReady;
    await waitFor(() => existsSync(marker));
    assert.equal((session as any).getHistoryMetadata().status, 'ready');
    await session.close();
  } finally {
    restoreEnv('CODEX_HOME', previousHome);
    restoreEnv('CODEX_PATH', previousPath);
    restoreEnv('CCW_TEST_CODEX_MARKER', previousMarker);
    await rm(dir, { recursive: true, force: true });
  }
});

test('closing a loading Codex session cancels work and always settles historyReady', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-codex-cancel-'));
  const previousHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const historyDir = join(dir, 'sessions', '2026', '07', '10');
    await mkdir(historyDir, { recursive: true });
    const file = join(historyDir, 'rollout-cancel-codex-thread.jsonl');
    await writeSyntheticCodexTranscript(file, 8 * 1024 * 1024, 'cancel-codex-thread');

    const session = new CodexSession({ id: 'cancel-codex', cwd: dir, resume: 'cancel-codex-thread' });
    await session.close();
    await Promise.race([
      session.historyReady,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('historyReady did not settle')), 1_000)),
    ]);
    assert.equal((session as any).getHistoryMetadata().cancelled, true);
  } finally {
    restoreEnv('CODEX_HOME', previousHome);
    await rm(dir, { recursive: true, force: true });
  }
});

test('closing a loading Claude session cancels work and always settles historyReady', async () => {
  const session = new ClaudeSession({
    id: 'cancel-claude',
    cwd: '/nonexistent-ccw-cancel',
    resume: 'missing-cancelled-session',
  });

  await session.close();
  await Promise.race([
    session.historyReady,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('historyReady did not settle')), 1_000)),
  ]);
  assert.equal((session as any).getHistoryMetadata().cancelled, true);
});

test('synthetic 200 MiB Codex history stays responsive and memory bounded', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ccw-codex-perf-'));
  const historyDir = join(dir, 'sessions', '2026', '07', '10');
  await mkdir(historyDir, { recursive: true });
  const file = join(historyDir, 'rollout-perf-codex-thread.jsonl');

  try {
    await writeSyntheticCodexTranscript(file, 200 * 1024 * 1024, 'perf-codex-thread');
    const moduleUrl = new URL('../agents/CodexSession.ts', import.meta.url).href;
    const script = `
      import { performance } from 'node:perf_hooks';
      const { CodexSession } = await import(${JSON.stringify(moduleUrl)});
      global.gc?.();
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      let last = performance.now();
      let maxGapMs = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        peak = Math.max(peak, process.memoryUsage().rss);
      }, 2);
      const started = performance.now();
      const session = new CodexSession({ id: 'perf-runtime', cwd: process.env.CODEX_HOME, resume: 'perf-codex-thread' });
      const constructorMs = performance.now() - started;
      await session.historyReady;
      await new Promise((resolve) => setImmediate(resolve));
      clearInterval(timer);
      peak = Math.max(peak, process.memoryUsage().rss);
      const beforeGc = process.memoryUsage();
      global.gc?.();
      const afterGc = process.memoryUsage();
      const metadata = session.getHistoryMetadata();
      const replayLength = session.replay().length;
      const ringBytes = session.ring.byteLength;
      const model = session.getState().model;
      await session.close();
      console.log(JSON.stringify({ constructorMs, maxGapMs, rssDelta: peak - baseline, metadata, replayLength, ringBytes, beforeGc, afterGc, model }));
    `;
    const result = await runChild(process.execPath, [
      '--expose-gc',
      '--import', 'tsx',
      '--input-type=module',
      '--eval', script,
    ], { ...process.env, CODEX_HOME: dir });
    const metrics = JSON.parse(result.trim().split('\n').at(-1)!) as {
      constructorMs: number;
      maxGapMs: number;
      rssDelta: number;
      metadata: { status: string; truncated: boolean };
      replayLength: number;
      ringBytes: number;
      beforeGc: NodeJS.MemoryUsage;
      afterGc: NodeJS.MemoryUsage;
      model?: string;
    };

    assert.ok(metrics.constructorMs < 5, `constructor took ${metrics.constructorMs.toFixed(1)}ms`);
    assert.ok(metrics.maxGapMs < 25, `event-loop gap was ${metrics.maxGapMs.toFixed(1)}ms`);
    assert.ok(metrics.rssDelta < 96 * 1024 * 1024, `RSS grew ${(metrics.rssDelta / 1024 / 1024).toFixed(1)} MiB`);
    assert.equal(metrics.metadata.status, 'ready');
    assert.equal(metrics.metadata.truncated, true);
    assert.equal(metrics.model, 'synthetic-model');
    assert.ok(metrics.replayLength <= 5_000);
    t.diagnostic([
      `constructor=${metrics.constructorMs.toFixed(2)}ms`,
      `event-loop-gap=${metrics.maxGapMs.toFixed(2)}ms`,
      `rss-delta=${(metrics.rssDelta / 1024 / 1024).toFixed(1)}MiB`,
      `replay-events=${metrics.replayLength}`,
    ].join(' '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeSyntheticCodexTranscript(path: string, targetBytes: number, sessionId: string): Promise<void> {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  const body = 'x'.repeat(24 * 1024);
  const largestObservedLine = 'y'.repeat(Math.min(targetBytes, 4 * 1024 * 1024));
  const metadata = `${JSON.stringify({
    type: 'session_meta',
    payload: { id: sessionId, model: 'synthetic-model' },
  })}\n`;
  let bytes = Buffer.byteLength(metadata);
  if (!stream.write(metadata)) await once(stream, 'drain');
  let index = 0;
  while (bytes < targetBytes) {
    const line = `${JSON.stringify({
      type: 'event_msg',
      payload: { type: 'agent_message', message: `synthetic-${index}-${index === 0 ? largestObservedLine : body}` },
    })}\n`;
    bytes += Buffer.byteLength(line);
    index += 1;
    if (!stream.write(line)) await once(stream, 'drain');
  }
  stream.end();
  await once(stream, 'finish');
}

async function runChild(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close') as [number | null];
  if (code !== 0) throw new Error(`child exited ${code}: ${stderr}`);
  return stdout;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for predicate');
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
