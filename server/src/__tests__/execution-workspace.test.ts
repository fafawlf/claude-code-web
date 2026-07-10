import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeSession } from '../session/ClaudeSession.js';
import { SessionManager } from '../session/SessionManager.js';
import { resolveHelloSession } from '../ws.js';
import { ExecutionWorkspace } from '../workspace/ExecutionWorkspace.js';
import { captureFsRootIdentity, type CcwUser } from '../users/identity.js';

test('cookie execution workspaces fail closed without Linux directory-fd isolation', {
  skip: process.platform === 'linux',
}, () => {
  assert.throws(
    () => ExecutionWorkspace.pin(
      realpathSync('/tmp'),
      realpathSync('/tmp'),
      captureFsRootIdentity(realpathSync('/tmp')),
    ),
    /requires Linux directory-fd isolation/i,
  );
});

test('Linux workspace lease keeps Codex and Claude on the pinned inode and rejects a cwd moved outside root', {
  skip: process.platform !== 'linux',
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'ccw-exec-workspace-'));
  const root = join(base, 'users', 'alice');
  const outside = join(base, 'outside');
  const originalCwd = join(root, 'project');
  mkdirSync(originalCwd, { recursive: true });
  mkdirSync(outside, { recursive: true });

  const fakeCodex = join(base, 'fake-codex.mjs');
  writeFileSync(fakeCodex, [
    '#!/usr/bin/env node',
    'import { realpathSync } from "node:fs";',
    'console.log(JSON.stringify({ type: "thread.started", thread_id: "pinned-thread" }));',
    'console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: realpathSync(process.cwd()) } }));',
    'console.log(JSON.stringify({ type: "turn.completed" }));',
  ].join('\n'));
  chmodSync(fakeCodex, 0o755);

  const oldCodexPath = process.env.CODEX_PATH;
  process.env.CODEX_PATH = fakeCodex;
  let sessionManager: SessionManager | undefined;
  let claude: ClaudeSession | undefined;
  try {
    const canonicalRoot = realpathSync(root);

    const user: CcwUser = {
      openId: 'ou_alice',
      email: 'alice@example.com',
      name: 'Alice',
      slug: 'alice',
      role: 'user',
      isAdmin: false,
      via: 'cookie',
      workspaceRoot: root,
      fsRoot: root,
      canonicalFsRoot: canonicalRoot,
      canonicalFsRootIdentity: captureFsRootIdentity(canonicalRoot),
    };
    sessionManager = new SessionManager();
    const created = resolveHelloSession(
      sessionManager,
      { type: 'hello', provider: 'codex', cwd: originalCwd },
      base,
      undefined,
      user,
    );
    const renamedCwd = join(root, 'project-pinned');
    renameSync(originalCwd, renamedCwd);
    symlinkSync(outside, originalCwd);

    const attached = resolveHelloSession(
      sessionManager,
      { type: 'hello', sessionId: created.session.id },
      base,
      undefined,
      user,
    );
    assert.equal(attached.session.id, created.session.id, 'live attach must use the pinned lease, not the replaced path');

    const codexEvents: any[] = [];
    attached.session.subscribe((event) => codexEvents.push(event.event));
    attached.session.sendUser('where am I?');
    await waitFor(() => attached.session.getState().runtimeStatus === 'idle' && codexEvents.some((event) => event.type === 'result'));
    const codexAnswer = codexEvents.find((event) => event.type === 'assistant')?.message?.content?.[0]?.text;
    assert.equal(codexAnswer, realpathSync(renamedCwd));
    assert.equal(attached.session.getState().cwd, originalCwd, 'public session cwd must remain stable');
    await sessionManager.closeAll();
    assert.throws(() => attached.session.assertWorkspaceLease(canonicalRoot), /lease is closed/i);
    sessionManager = undefined;

    rmSync(originalCwd);
    const claudeOriginalCwd = join(root, 'claude-project');
    mkdirSync(claudeOriginalCwd);
    const claudeLease = ExecutionWorkspace.pin(
      claudeOriginalCwd,
      canonicalRoot,
      captureFsRootIdentity(canonicalRoot),
    );
    claude = new ClaudeSession({ id: 'pinned-claude', cwd: claudeOriginalCwd, workspaceLease: claudeLease });
    const claudeOptions = (claude as any).buildOptions();
    assert.equal(claudeOptions.cwd, claudeOriginalCwd, 'SDK configuration keeps the public cwd');
    assert.equal(typeof claudeOptions.spawnClaudeCodeProcess, 'function');

    const claudeRenamedCwd = join(root, 'claude-project-pinned');
    renameSync(claudeOriginalCwd, claudeRenamedCwd);
    symlinkSync(outside, claudeOriginalCwd);
    const spawned = claudeOptions.spawnClaudeCodeProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(require("node:fs").realpathSync(process.cwd()))'],
      cwd: claudeOriginalCwd,
      env: process.env,
      signal: new AbortController().signal,
    });
    const outputPromise = readAll(spawned.stdout);
    await once(spawned as NodeJS.EventEmitter, 'exit');
    const output = await outputPromise;
    assert.equal(output, realpathSync(claudeRenamedCwd));
    assert.equal(claude.getState().cwd, claudeOriginalCwd);

    const movedOutside = join(outside, 'moved-project');
    renameSync(claudeRenamedCwd, movedOutside);
    assert.throws(() => claude?.assertWorkspaceLease(canonicalRoot), /no longer safe/i);
    await claude.close();
    assert.equal(existsSync(claudeLease.spawnCwd), false, 'closing a session releases its directory fd');
    claude = undefined;
  } finally {
    await sessionManager?.closeAll();
    await claude?.close();
    if (oldCodexPath === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = oldCodexPath;
    rmSync(base, { recursive: true, force: true });
  }
});

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let output = '';
  for await (const chunk of stream) output += chunk.toString('utf8');
  return output;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for pinned process');
}
