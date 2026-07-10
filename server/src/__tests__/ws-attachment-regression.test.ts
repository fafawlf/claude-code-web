import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AgentProvider, AgentSession, AgentSessionOptions } from '../agents/types.js';
import { tokenModeConfig } from '../config.js';
import { NodeRegistry } from '../nodes/NodeRegistry.js';
import { PermissionBroker } from '../permissions/PermissionBroker.js';
import { PlanBroker } from '../permissions/PlanBroker.js';
import type {
  AgentProviderId,
  PendingControl,
  PermissionMode,
  ServerMessage,
  SessionStateSnapshot,
} from '../protocol.js';
import type { ControlListener, EventListener, SessionEvent, StateListener } from '../session/ClaudeSession.js';
import type { HistoryLoadMetadata } from '../session/ReplayBuffer.js';
import { SessionManager } from '../session/SessionManager.js';
import { registerWs } from '../ws.js';

class FakeSession implements AgentSession {
  readonly id: string;
  readonly permissionBroker = new PermissionBroker(() => {});
  readonly planBroker = new PlanBroker(() => {});
  readonly historyReady: Promise<void>;
  private resolveReady!: () => void;
  private state: SessionStateSnapshot;
  private ring: SessionEvent[] = [];
  private eventListeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private controlListeners = new Set<ControlListener>();
  private closed = false;
  private historyMetadata: HistoryLoadMetadata;
  readonly userMessages: string[] = [];
  interruptCount = 0;

  constructor(opts: AgentSessionOptions, ready: boolean) {
    this.id = opts.id;
    this.state = {
      sessionId: opts.id,
      nodeId: opts.nodeId ?? 'local',
      nodeLabel: opts.nodeLabel,
      provider: opts.provider ?? 'claude',
      providerSessionId: opts.resume,
      claudeSessionId: opts.resume,
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode ?? 'default',
      runtimeStatus: 'idle',
      attachedCount: 0,
      lastEventId: 0,
      lastEventAt: Date.now(),
      tokensIn: 0,
      tokensOut: 0,
      viewerMode: opts.viewerMode,
    };
    this.historyReady = new Promise<void>((resolve) => { this.resolveReady = resolve; });
    this.historyMetadata = { status: ready ? 'ready' : 'loading', truncated: false };
    if (ready) this.resolveReady();
  }

  resolveHistory(options: { truncated?: boolean } = {}): void {
    this.historyMetadata = { status: 'ready', truncated: !!options.truncated };
    this.resolveReady();
  }
  failHistory(error = 'synthetic history failure'): void {
    this.historyMetadata = { status: 'error', truncated: false, error };
    this.resolveReady();
  }
  listenerCount(): number { return this.eventListeners.size + this.stateListeners.size + this.controlListeners.size; }

  seedHistory(count: number): void {
    this.ring = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      event: { type: 'assistant', label: `history-${index + 1}`, content: 'x'.repeat(48) },
    })) as SessionEvent[];
    this.state = {
      ...this.state,
      lastEventId: count,
      lastEventAt: Date.now(),
    };
  }

  emitEvent(id: number, label: string): void {
    const event = { id, event: { type: 'assistant', label } } as SessionEvent;
    this.ring = [...this.ring.filter((entry) => entry.id !== id), event].sort((a, b) => a.id - b.id);
    this.state = { ...this.state, lastEventId: Math.max(this.state.lastEventId, id), lastEventAt: Date.now() };
    for (const listener of this.eventListeners) listener(event);
  }

  sendUser(text: string): void { this.userMessages.push(text); }
  async setModel(model: string): Promise<void> { this.updateState({ model }); }
  async setClaudeAuthMode(): Promise<void> {}
  async setPermissionMode(permissionMode: PermissionMode): Promise<void> { this.updateState({ permissionMode }); }
  async interrupt(): Promise<void> { this.interruptCount += 1; }
  async refreshHistory(): Promise<number> { return 0; }
  isViewer(): boolean { return !!this.state.viewerMode; }
  isClosed(): boolean { return this.closed; }
  async close(): Promise<void> { this.closed = true; }
  getState(): SessionStateSnapshot { return { ...this.state }; }
  getHistoryMetadata(): HistoryLoadMetadata { return { ...this.historyMetadata }; }
  replay(afterId = 0): SessionEvent[] { return this.ring.filter((event) => event.id > afterId); }
  subscribe(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
  subscribeControls(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }
  getPendingControls(): PendingControl[] { return []; }

  private updateState(state: Partial<SessionStateSnapshot>): void {
    this.state = { ...this.state, ...state };
    for (const listener of this.stateListeners) listener(state);
  }
}

class FakeProvider implements AgentProvider {
  readonly label: string;
  readyByDefault = true;
  readonly sessions: FakeSession[] = [];

  constructor(readonly id: AgentProviderId) { this.label = `Fake ${id}`; }

  createSession(opts: AgentSessionOptions): AgentSession {
    const session = new FakeSession(opts, this.readyByDefault);
    if (opts.resume === 'stored-history') {
      session.emitEvent(1, 'one');
      session.emitEvent(2, 'two');
      session.emitEvent(3, 'three');
      session.resolveHistory();
    }
    this.sessions.push(session);
    return session;
  }
}

type Inbox = {
  all: ServerMessage[];
  next(predicate: (message: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
};

function inboxFor(ws: WebSocket): Inbox {
  const all: ServerMessage[] = [];
  const waiters = new Set<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }>();
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    all.push(message);
    for (const waiter of waiters) {
      if (!waiter.predicate(message)) continue;
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  });
  return {
    all,
    next(predicate, timeoutMs = 1000) {
      const existing = all.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = { predicate, resolve: (message: ServerMessage) => {
          clearTimeout(timer);
          resolve(message);
        } };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for WS frame; received ${JSON.stringify(all)}`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
  };
}

async function setup(providers: AgentProvider[]): Promise<{
  app: FastifyInstance;
  sm: SessionManager;
  ws: WebSocket;
  inbox: Inbox;
}> {
  const app = Fastify({ logger: false });
  const sm = new SessionManager(providers);
  await app.register(fastifyWebsocket);
  registerWs(app, sm, 'test-token', '/tmp', new NodeRegistry('/tmp'), { config: tokenModeConfig() });
  await app.ready();
  const ws = await app.injectWS('/ws?t=test-token');
  return { app, sm, ws, inbox: inboxFor(ws) };
}

async function cleanup(app: FastifyInstance, sm: SessionManager, ws: WebSocket): Promise<void> {
  if (ws.readyState !== ws.CLOSED) {
    const closed = once(ws, 'close');
    ws.terminate();
    await closed;
  }
  await sm.closeAll();
  await app.close();
}

function send(ws: WebSocket, message: object): void {
  ws.send(JSON.stringify(message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await sleep(5);
  }
}

test('rapid A to B attach cancels delayed A replay, listeners, and attach count', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const a = sm.create({ cwd: '/a' }) as FakeSession;
    provider.readyByDefault = true;
    const b = sm.create({ cwd: '/b' }) as FakeSession;
    const aManagerListeners = a.listenerCount();
    const bManagerListeners = b.listenerCount();

    send(ws, { type: 'hello', sessionId: a.id, attachId: 'attach-a' });
    const readyA = await inbox.next((message) => message.type === 'ready' && message.attachId === 'attach-a');
    assert.equal(readyA.type, 'ready');
    assert.equal(readyA.historyStatus, 'loading');
    a.emitEvent(1, 'must-not-leak');

    send(ws, { type: 'hello', sessionId: b.id, attachId: 'attach-b' });
    const readyB = await inbox.next((message) => message.type === 'ready' && message.attachId === 'attach-b');
    assert.equal(readyB.type, 'ready');
    assert.equal(readyB.state.sessionId, b.id);
    const completeB = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'attach-b' && message.replayComplete === true
    );
    assert.equal(completeB.type, 'sdk_events_batch');
    assert.deepEqual(completeB.events, []);

    a.resolveHistory();
    a.emitEvent(2, 'also-must-not-leak');
    await sleep(40);
    const firstB = inbox.all.findIndex((message) => message.type === 'ready' && message.attachId === 'attach-b');
    assert.equal(inbox.all.slice(firstB + 1).some((message) => message.attachId === 'attach-a'), false);
    assert.equal(sm.getSnapshot(a.id)?.attachedCount, 0);
    assert.equal(sm.getSnapshot(b.id)?.attachedCount, 1);
    assert.equal(a.listenerCount(), aManagerListeners);
    assert.equal(b.listenerCount(), bManagerListeners + 3);

    const closed = once(ws, 'close');
    ws.terminate();
    await closed;
    // Client close fires before the injected server peer has necessarily run
    // its close handler.
    await sleep(20);
    assert.equal(sm.getSnapshot(b.id)?.attachedCount, 0);
    assert.equal(b.listenerCount(), bManagerListeners);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('events emitted during history loading are replayed once before live events', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/buffered' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'buffered' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'buffered');

    session.emitEvent(1, 'during-load');
    session.resolveHistory();
    const replay = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'buffered' && message.replayComplete === true
    );
    assert.equal(replay.type, 'sdk_events_batch');
    assert.deepEqual(replay.events.map((entry) => entry.id), [1]);

    session.emitEvent(2, 'live');
    const live = await inbox.next(
      (message) => message.type === 'sdk_event' && message.attachId === 'buffered' && message.id === 2
    );
    assert.equal(live.type, 'sdk_event');
    assert.equal(live.sessionId, session.id);
    assert.equal(inbox.all.filter((message) => message.type === 'sdk_events_batch')
      .flatMap((message) => message.events).filter((entry) => entry.id === 1).length, 1);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('history loading beyond three seconds never emits a false replay completion', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/slow-history' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'slow-history' });
    const ready = await inbox.next((message) => message.type === 'ready' && message.attachId === 'slow-history');
    assert.equal(ready.type, 'ready');
    assert.equal(ready.historyStatus, 'loading');

    await sleep(3_100);
    assert.equal(inbox.all.some((message) => message.type === 'sdk_events_batch' && message.attachId === 'slow-history' && message.replayComplete), false);

    session.resolveHistory();
    const complete = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'slow-history' && message.replayComplete === true,
    );
    assert.equal(complete.type, 'sdk_events_batch');
    assert.equal(complete.historyStatus, 'ready');
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('history error and truncation metadata reflect the settled loader outcome', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const failed = sm.create({ cwd: '/failed-history' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: failed.id, attachId: 'failed-history' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'failed-history');
    failed.failHistory('disk read failed');
    const error = await inbox.next((message) => message.type === 'error' && message.attachId === 'failed-history');
    assert.equal(error.type, 'error');
    assert.match(error.message, /disk read failed/);
    const failedComplete = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'failed-history' && message.replayComplete === true,
    );
    assert.equal(failedComplete.type, 'sdk_events_batch');
    assert.equal(failedComplete.historyStatus, 'error');

    provider.readyByDefault = false;
    const truncated = sm.create({ cwd: '/truncated-history' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: truncated.id, attachId: 'truncated-history' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'truncated-history');
    truncated.resolveHistory({ truncated: true });
    const truncatedComplete = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'truncated-history' && message.replayComplete === true,
    );
    assert.equal(truncatedComplete.type, 'sdk_events_batch');
    assert.equal(truncatedComplete.historyStatus, 'ready');
    assert.equal(truncatedComplete.historyTruncated, true);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('closing a socket aborts a pending attachment history wait and removes its listeners', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/close-loading' }) as FakeSession;
    const baselineListeners = session.listenerCount();
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'close-loading' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'close-loading');
    assert.equal(session.listenerCount(), baselineListeners + 3);

    const closed = once(ws, 'close');
    ws.terminate();
    await closed;
    await sleep(20);
    assert.equal(session.listenerCount(), baselineListeners);
    assert.equal(sm.getSnapshot(session.id)?.attachedCount, 0);
    session.resolveHistory();
    await sleep(20);
    assert.equal(inbox.all.some((message) => message.type === 'sdk_events_batch' && message.attachId === 'close-loading'), false);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('session commands are rejected until replay completes, then accepted with matching scope', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/command-gate' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'command-gate' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'command-gate');
    send(ws, { type: 'user', text: 'too early', attachId: 'command-gate', sessionId: session.id });
    const rejected = await inbox.next((message) => message.type === 'error' && message.attachId === 'command-gate' && /still syncing/i.test(message.message));
    assert.equal(rejected.type, 'error');
    assert.deepEqual(session.userMessages, []);

    session.resolveHistory();
    await inbox.next((message) => message.type === 'sdk_events_batch' && message.attachId === 'command-gate' && message.replayComplete === true);
    send(ws, { type: 'user', text: 'after replay', attachId: 'command-gate', sessionId: session.id });
    await waitFor(() => session.userMessages.length === 1);
    assert.deepEqual(session.userMessages, ['after replay']);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('a delayed command from attachment A cannot act on attachment B', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const a = sm.create({ cwd: '/command-a' }) as FakeSession;
    const b = sm.create({ cwd: '/command-b' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: a.id, attachId: 'command-a' });
    await inbox.next((message) => message.type === 'sdk_events_batch' && message.attachId === 'command-a' && message.replayComplete === true);
    send(ws, { type: 'hello', sessionId: b.id, attachId: 'command-b' });
    await inbox.next((message) => message.type === 'sdk_events_batch' && message.attachId === 'command-b' && message.replayComplete === true);

    send(ws, { type: 'user', text: 'stale-a', attachId: 'command-a', sessionId: a.id });
    const rejected = await inbox.next((message) => message.type === 'error' && message.attachId === 'command-b' && /stale/i.test(message.message));
    assert.equal(rejected.type, 'error');
    assert.deepEqual(a.userMessages, []);
    assert.deepEqual(b.userMessages, []);

    send(ws, { type: 'interrupt', attachId: 'command-b', sessionId: b.id });
    await waitFor(() => b.interruptCount === 1);
    assert.equal(a.interruptCount, 0);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('legacy unscoped commands are compatible only before the socket switches sessions', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const a = sm.create({ cwd: '/legacy-a' }) as FakeSession;
    const b = sm.create({ cwd: '/legacy-b' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: a.id });
    await inbox.next((message) => message.type === 'sdk_events_batch' && message.sessionId === a.id && message.replayComplete === true);
    send(ws, { type: 'user', text: 'legacy-first' });
    await waitFor(() => a.userMessages.length === 1);

    send(ws, { type: 'hello', sessionId: b.id });
    await inbox.next((message) => message.type === 'sdk_events_batch' && message.sessionId === b.id && message.replayComplete === true);
    send(ws, { type: 'user', text: 'legacy-ambiguous' });
    const rejected = await inbox.next((message) => message.type === 'error' && message.sessionId === b.id && /unscoped/i.test(message.message));
    assert.equal(rejected.type, 'error');
    assert.deepEqual(b.userMessages, []);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('events emitted while a large replay is being batched arrive after replay completion', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/large-ordering' }) as FakeSession;
    session.seedHistory(5_000);
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'large-ordering' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'large-ordering');

    // Async replay construction has started and yielded after its first slice.
    session.emitEvent(5_001, 'live-during-replay');
    const complete = await inbox.next(
      (message) => message.type === 'sdk_events_batch'
        && message.attachId === 'large-ordering'
        && message.replayComplete === true,
      2_000
    );
    assert.equal(complete.type, 'sdk_events_batch');
    const live = await inbox.next(
      (message) => message.type === 'sdk_event'
        && message.attachId === 'large-ordering'
        && message.id === 5_001,
      2_000
    );
    assert.equal(live.type, 'sdk_event');

    const completeIndex = inbox.all.indexOf(complete);
    const liveIndex = inbox.all.indexOf(live);
    assert.ok(completeIndex >= 0 && liveIndex > completeIndex);
    assert.equal(inbox.all
      .filter((message) => message.type === 'sdk_events_batch')
      .flatMap((message) => message.events)
      .some((event) => event.id === 5_001), false);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('A to B to C burst leaves only the final attachment active', async () => {
  const provider = new FakeProvider('claude');
  provider.readyByDefault = false;
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const a = sm.create({ cwd: '/a' }) as FakeSession;
    const b = sm.create({ cwd: '/b' }) as FakeSession;
    provider.readyByDefault = true;
    const c = sm.create({ cwd: '/c' }) as FakeSession;

    send(ws, { type: 'hello', sessionId: a.id, attachId: 'burst-a' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'burst-a');
    send(ws, { type: 'hello', sessionId: b.id, attachId: 'burst-b' });
    send(ws, { type: 'hello', sessionId: c.id, attachId: 'burst-c' });
    await inbox.next((message) => message.type === 'ready' && message.attachId === 'burst-c');
    await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'burst-c' && message.replayComplete === true
    );

    a.emitEvent(1, 'late-a');
    b.emitEvent(1, 'late-b');
    a.resolveHistory();
    b.resolveHistory();
    await sleep(40);
    const cIndex = inbox.all.findIndex((message) => message.type === 'ready' && message.attachId === 'burst-c');
    assert.equal(inbox.all.slice(cIndex + 1).some((message) => message.attachId === 'burst-a' || message.attachId === 'burst-b'), false);
    assert.equal(sm.getSnapshot(a.id)?.attachedCount, 0);
    assert.equal(sm.getSnapshot(b.id)?.attachedCount, 0);
    assert.equal(sm.getSnapshot(c.id)?.attachedCount, 1);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('cursor produces delta replay only for the exact live wrapper', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    const session = sm.create({ cwd: '/delta' }) as FakeSession;
    session.emitEvent(1, 'one');
    session.emitEvent(2, 'two');
    send(ws, {
      type: 'hello',
      sessionId: session.id,
      lastEventId: 1,
      attachId: 'delta',
    });
    const ready = await inbox.next((message) => message.type === 'ready' && message.attachId === 'delta');
    assert.equal(ready.type, 'ready');
    assert.equal(ready.replayMode, 'delta');
    assert.equal(ready.historyStatus, 'ready');
    const replay = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'delta' && message.replayComplete === true
    );
    assert.equal(replay.type, 'sdk_events_batch');
    assert.deepEqual(replay.events.map((entry) => entry.id), [2]);

    send(ws, { type: 'set_model', model: 'next-model', attachId: 'delta', sessionId: session.id });
    const state = await inbox.next(
      (message) => message.type === 'state_update' && message.attachId === 'delta' && message.state.model === 'next-model'
    );
    assert.equal(state.type, 'state_update');
    assert.equal(state.sessionId, session.id);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('expired runtime cursor is ignored and a new wrapper receives full replay', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    send(ws, {
      type: 'hello',
      sessionId: 'expired-runtime',
      resumeClaudeId: 'stored-history',
      cwd: '/history',
      lastEventId: 2,
      attachId: 'recovered',
      viewerMode: true,
    });
    const ready = await inbox.next((message) => message.type === 'ready' && message.attachId === 'recovered');
    assert.equal(ready.type, 'ready');
    assert.equal(ready.replayMode, 'full');
    const replay = await inbox.next(
      (message) => message.type === 'sdk_events_batch' && message.attachId === 'recovered' && message.replayComplete === true
    );
    assert.equal(replay.type, 'sdk_events_batch');
    assert.deepEqual(replay.events.map((entry) => entry.id), [1, 2, 3]);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('list_sessions works before hello and manager changes are not broadcast', async () => {
  const provider = new FakeProvider('claude');
  const { app, sm, ws, inbox } = await setup([provider]);
  try {
    sm.create({ cwd: '/one' });
    send(ws, { type: 'list_sessions' });
    const listed = await inbox.next((message) => message.type === 'sessions_update');
    assert.equal(listed.type, 'sessions_update');
    assert.equal(listed.sessions.length, 1);

    const updatesBefore = inbox.all.filter((message) => message.type === 'sessions_update').length;
    sm.create({ cwd: '/two' });
    await sleep(40);
    assert.equal(inbox.all.filter((message) => message.type === 'sessions_update').length, updatesBefore);
  } finally {
    await cleanup(app, sm, ws);
  }
});

test('existing Codex session infers provider unless hello explicitly contradicts it', async () => {
  const claude = new FakeProvider('claude');
  const codex = new FakeProvider('codex');
  const { app, sm, ws, inbox } = await setup([claude, codex]);
  try {
    const session = sm.create({ cwd: '/codex', provider: 'codex' }) as FakeSession;
    send(ws, { type: 'hello', sessionId: session.id, attachId: 'codex-ok' });
    const ready = await inbox.next((message) => message.type === 'ready' && message.attachId === 'codex-ok');
    assert.equal(ready.type, 'ready');
    assert.equal(ready.state.provider, 'codex');

    send(ws, { type: 'hello', sessionId: session.id, provider: 'claude', attachId: 'codex-wrong' });
    const error = await inbox.next((message) => message.type === 'error' && message.attachId === 'codex-wrong');
    assert.equal(error.type, 'error');
    assert.match(error.message, /belongs to local\/codex/i);
    assert.equal(sm.getSnapshot(session.id)?.attachedCount, 0);
  } finally {
    await cleanup(app, sm, ws);
  }
});
