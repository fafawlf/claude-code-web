import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import type { AgentSession } from './agents/types.js';
import { defaultClaudeAuthMode, hasClaudeApiKey } from './authInfo.js';
import { tokenModeConfig, type CcwConfig } from './config.js';
import { NodeRegistry } from './nodes/NodeRegistry.js';
import {
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_NODE_ID,
  defaultModelForProvider,
  type ClientHello,
  type ClientMessage,
  type PendingControl,
  type PermissionMode,
  type ReplayMode,
  type ServerAttachmentScope,
  type ServerMessage,
  type SessionStateSnapshot,
} from './protocol.js';
import type { SessionEvent } from './session/ClaudeSession.js';
import type { SessionManager } from './session/SessionManager.js';
import { resolveScoped, resolveUser, tokenAdmin, type CcwUser, type IdentityContext } from './users/identity.js';
import type { UserRegistry } from './users/registry.js';
import { buildReplayBatches, WsSendQueue } from './wsSendQueue.js';
import type { HistoryLoadMetadata } from './session/ReplayBuffer.js';

export type WsIdentityOptions = {
  config: CcwConfig;
  registry?: UserRegistry;
};

type HelloResolution = {
  session: AgentSession;
  /** Kept as the requested cursor for compatibility with existing callers.
   * Runtime attach MUST ignore it whenever replayMode is full. */
  replayAfterId: number;
  replayMode: ReplayMode;
  recovered: boolean;
};

type AttachmentContext = {
  generation: number;
  attachId?: string;
  session: AgentSession;
  sessionId: string;
  abort: AbortController;
  unsubs: Array<() => void>;
  counted: boolean;
  detached: boolean;
  replaying: boolean;
  liveEvents: SessionEvent[];
  readySent: boolean;
  replayComplete: boolean;
  pendingState: Partial<SessionStateSnapshot>;
  pendingControls: PendingControl[];
  sentControls: Set<string>;
};

export function registerWs(
  app: FastifyInstance,
  sm: SessionManager,
  token: string,
  defaultCwd: string,
  nodes = new NodeRegistry(defaultCwd),
  identity: WsIdentityOptions = { config: tokenModeConfig() }
) {
  const idCtx: IdentityContext = {
    token,
    defaultCwd,
    config: identity.config,
    registry: identity.registry,
  };

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const writer = new WsSendQueue(socket);
    const user = resolveUser(req, idCtx);
    if (!user) {
      writer.send({ type: 'error', message: 'Unauthorized' });
      socket.close(1008, 'Unauthorized');
      writer.close();
      return;
    }
    // SameSite does not cover WebSocket handshakes, so cookie-authenticated
    // sockets must prove they come from our own origin. Token auth (CLI,
    // tunnels, native apps) carries the secret itself and skips this.
    if (user.via === 'cookie') {
      const origin = req.headers.origin;
      if (!origin || !identity.config.publicOrigin || origin !== identity.config.publicOrigin) {
        writer.send({ type: 'error', message: 'Origin not allowed' });
        socket.close(1008, 'Origin not allowed');
        writer.close();
        return;
      }
    }

    const visibleSessions = (): SessionStateSnapshot[] =>
      user.via === 'token' || user.isAdmin ? sm.listSnapshots() : sm.listSnapshotsForOwner(user.openId);

    let attachment: AttachmentContext | undefined;
    let generation = 0;
    let socketClosed = false;

    const scopeFor = (ctx: AttachmentContext): ServerAttachmentScope => ({
      attachId: ctx.attachId,
      sessionId: ctx.sessionId,
    });
    const isCurrent = (ctx: AttachmentContext): boolean =>
      !socketClosed && !ctx.detached && attachment === ctx && generation === ctx.generation;
    const scopedSend = (
      ctx: AttachmentContext,
      message: ServerMessage,
      priority?: 'control' | 'replay'
    ): boolean => {
      if (!isCurrent(ctx)) return false;
      return writer.send({ ...message, ...scopeFor(ctx) } as ServerMessage, priority, ctx.generation);
    };

    const detachContext = (ctx: AttachmentContext): void => {
      if (ctx.detached) return;
      ctx.detached = true;
      ctx.abort.abort();
      writer.cancelGeneration(ctx.generation);
      for (const unsub of ctx.unsubs.splice(0)) {
        try { unsub(); } catch { /* best effort */ }
      }
      if (ctx.counted) {
        ctx.counted = false;
        sm.detach(ctx.sessionId);
      }
      if (attachment === ctx) attachment = undefined;
    };

    const supersedeAttachment = (): number => {
      if (attachment) detachContext(attachment);
      // Also clears queued errors from a previous failed hello, which has no
      // AttachmentContext to own it.
      writer.cancelGeneration(generation);
      generation += 1;
      return generation;
    };

    const sendControl = (ctx: AttachmentContext, control: PendingControl): void => {
      const key = `${control.kind}:${control.reqId}`;
      if (ctx.sentControls.has(key) || !isCurrent(ctx)) return;
      ctx.sentControls.add(key);
      scopedSend(ctx, { type: 'pending_control', sessionId: ctx.sessionId, control });
      if (control.kind === 'permission') {
        const { kind: _kind, ...request } = control;
        scopedSend(ctx, { type: 'permission_request', ...request });
      } else {
        scopedSend(ctx, { type: 'plan_proposed', reqId: control.reqId, plan: control.plan });
      }
    };

    const attach = async (resolved: HelloResolution, attachId: string | undefined, ownGeneration: number) => {
      if (socketClosed || generation !== ownGeneration) return;
      const s = resolved.session;
      const ctx: AttachmentContext = {
        generation: ownGeneration,
        attachId,
        session: s,
        sessionId: s.id,
        abort: new AbortController(),
        unsubs: [],
        counted: true,
        detached: false,
        replaying: true,
        liveEvents: [],
        readySent: false,
        replayComplete: false,
        pendingState: {},
        pendingControls: [],
        sentControls: new Set(),
      };
      attachment = ctx;
      sm.attach(s.id);

      // Subscribe before taking the replay snapshot. Events emitted while
      // history is loading are buffered and merged with the ring by event id,
      // closing the old replay-then-subscribe loss window.
      ctx.unsubs.push(
        s.subscribe((event) => {
          if (!isCurrent(ctx)) return;
          if (ctx.replaying) ctx.liveEvents.push(event);
          else scopedSend(ctx, { type: 'sdk_event', id: event.id, event: event.event });
        }),
        s.subscribeState((state) => {
          if (!isCurrent(ctx)) return;
          if (!ctx.readySent) Object.assign(ctx.pendingState, state);
          else scopedSend(ctx, { type: 'state_update', state });
        }),
        s.subscribeControls((control) => {
          if (!isCurrent(ctx)) return;
          if (!ctx.replayComplete) ctx.pendingControls.push(control);
          else sendControl(ctx, control);
        })
      );

      const initialHistory = await probeHistoryMetadata(s);
      if (!isCurrent(ctx)) return;
      const effectiveAfterId = resolved.replayMode === 'delta' ? resolved.replayAfterId : 0;
      const initialReplay = initialHistory.status === 'ready' ? s.replay(effectiveAfterId) : [];
      const historyTruncated = initialHistory.status === 'ready'
        ? initialHistory.truncated || isReplayTruncated(initialReplay, effectiveAfterId, s.getState().lastEventId)
        : initialHistory.truncated;

      ctx.readySent = true;
      scopedSend(ctx, {
        type: 'ready',
        state: sm.getSnapshot(s.id) ?? s.getState(),
        replayMode: resolved.replayMode,
        historyStatus: initialHistory.status,
        historyTruncated: historyTruncated || undefined,
      });
      if (Object.keys(ctx.pendingState).length > 0) {
        scopedSend(ctx, { type: 'state_update', state: ctx.pendingState });
        ctx.pendingState = {};
      }
      const history = initialHistory.status === 'loading'
        ? await waitForHistoryReady(s, ctx.abort.signal)
        : initialHistory;
      if (!isCurrent(ctx) || history === 'aborted') return;
      if (history.status === 'error') {
        scopedSend(ctx, { type: 'error', message: history.error ? `History loading failed: ${history.error}` : 'History loading failed' });
      }

      // Runtime correctness is intentionally based on replayMode, not merely
      // replayAfterId: a cursor from a reaped/new wrapper must never suppress
      // its fresh history, even though resolveHelloSession keeps the legacy
      // helper field for compatibility with older unit callers.
      const replayAfterId = resolved.replayMode === 'delta' ? resolved.replayAfterId : 0;
      const replay = dedupeEvents([...s.replay(replayAfterId), ...ctx.liveEvents], replayAfterId);
      const finalHistoryTruncated = history.truncated
        || isReplayTruncated(replay, replayAfterId, s.getState().lastEventId);
      ctx.liveEvents = [];

      for await (const batch of buildReplayBatches(replay, scopeFor(ctx), { signal: ctx.abort.signal })) {
        const frame = batch.replayComplete
          ? {
              ...batch,
              historyStatus: history.status,
              historyTruncated: finalHistoryTruncated || undefined,
            }
          : batch;
        if (!isCurrent(ctx) || !scopedSend(ctx, frame, 'replay')) return;
      }
      if (!isCurrent(ctx)) return;
      ctx.replayComplete = true;

      // Keep events emitted while batches were being constructed behind the
      // replay completion frame. Both history and live SDK frames share the
      // replay FIFO lane; state, heartbeat, and approval controls may still
      // overtake that lane on slow connections.
      const replayHighWater = replay.at(-1)?.id ?? replayAfterId;
      const trailingLive = dedupeEvents(ctx.liveEvents, replayHighWater);
      ctx.liveEvents = [];
      for (const event of trailingLive) {
        if (!scopedSend(ctx, { type: 'sdk_event', id: event.id, event: event.event }, 'replay')) return;
      }
      ctx.replaying = false;
      for (const control of [...ctx.pendingControls, ...s.getPendingControls()]) sendControl(ctx, control);
      ctx.pendingControls = [];
    };

    const heartbeat = setInterval(() => {
      const now = Date.now();
      const ctx = attachment;
      const snapshot = ctx ? sm.getSnapshot(ctx.sessionId) : undefined;
      const frame: ServerMessage = {
        type: 'heartbeat',
        now,
        session: snapshot,
        noActivityMs: snapshot ? Math.max(0, now - snapshot.lastEventAt) : undefined,
      };
      if (ctx && isCurrent(ctx)) scopedSend(ctx, frame);
      else writer.send(frame);
    }, 5000);
    heartbeat.unref?.();

    socket.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch {
        writer.send({ type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'hello') {
        // Switching sessions only detaches this socket. The previous session
        // keeps running in the background until the user explicitly closes it.
        const ownGeneration = supersedeAttachment();
        try {
          const resolved = resolveHelloSession(sm, msg, defaultCwd, nodes, user);
          await attach(resolved, msg.attachId, ownGeneration);
        } catch (error) {
          if (!socketClosed && generation === ownGeneration) {
            writer.send({
              type: 'error',
              message: (error as Error).message,
              attachId: msg.attachId,
              sessionId: msg.sessionId,
            }, 'control', ownGeneration);
          }
        }
        return;
      }

      // This command is explicitly valid before hello. Session lists are sent
      // only on demand; manager updates and heartbeat no longer broadcast them.
      if (msg.type === 'list_sessions') {
        writer.send({ type: 'sessions_update', sessions: visibleSessions() });
        return;
      }

      if (msg.type === 'session_close') {
        const current = attachment;
        if (msg.attachId !== undefined && (!current || !isCurrent(current) || msg.attachId !== current.attachId)) {
          writer.send({ type: 'error', message: 'Stale attachment command rejected', attachId: msg.attachId, sessionId: msg.sessionId });
          return;
        }
        if (user.via === 'cookie' && !user.isAdmin && sm.ownerOf(msg.sessionId) !== user.openId) {
          writer.send({ type: 'error', message: 'Not your session', sessionId: msg.sessionId });
          return;
        }
        const ctx = attachment;
        if (ctx?.sessionId === msg.sessionId) detachContext(ctx);
        await sm.remove(msg.sessionId).catch((error) => {
          writer.send({ type: 'error', message: (error as Error).message, sessionId: msg.sessionId });
        });
        return;
      }

      const ctx = attachment;
      if (!ctx || !isCurrent(ctx)) {
        writer.send({ type: 'error', message: 'Say hello first' });
        return;
      }
      const scopeError = validateCommandScope(ctx, msg, generation);
      if (scopeError) {
        // Echo an explicitly stale scope instead of relabelling the error as
        // current. Modern clients will ignore it, so a delayed A command cannot
        // create a toast or error item in the newly selected B conversation.
        writer.send({
          type: 'error',
          message: scopeError,
          attachId: msg.attachId ?? ctx.attachId,
          sessionId: msg.sessionId ?? ctx.sessionId,
        }, 'control', ctx.generation);
        return;
      }
      if (!ctx.readySent || !ctx.replayComplete) {
        scopedSend(ctx, { type: 'error', message: 'Session is still syncing; retry when history replay is complete' });
        return;
      }
      const session = ctx.session;

      switch (msg.type) {
        case 'user':
          session.sendUser(msg.text);
          break;
        case 'permission_response':
          session.permissionBroker.resolve(msg.reqId, { decision: msg.decision, scope: msg.scope });
          break;
        case 'plan_response':
          session.planBroker.resolve(msg.reqId, msg.decision);
          break;
        case 'interrupt':
          await session.interrupt();
          break;
        case 'set_model':
          try { await session.setModel(msg.model); }
          catch (error) { scopedSend(ctx, { type: 'error', message: `setModel failed: ${(error as Error).message}` }); }
          break;
        case 'set_claude_auth_mode':
          try { await session.setClaudeAuthMode(msg.mode); }
          catch (error) { scopedSend(ctx, { type: 'error', message: `setClaudeAuthMode failed: ${(error as Error).message}` }); }
          break;
        case 'set_permission_mode':
          try { await session.setPermissionMode(msg.mode as PermissionMode); }
          catch (error) { scopedSend(ctx, { type: 'error', message: `setPermissionMode failed: ${(error as Error).message}` }); }
          break;
        case 'refresh_history':
          try { await session.refreshHistory(); }
          catch (error) { scopedSend(ctx, { type: 'error', message: `refreshHistory failed: ${(error as Error).message}` }); }
          break;
      }
    });

    socket.on('close', () => {
      if (socketClosed) return;
      socketClosed = true;
      clearInterval(heartbeat);
      if (attachment) detachContext(attachment);
      writer.close();
    });
  });
}

async function probeHistoryMetadata(session: AgentSession): Promise<HistoryLoadMetadata> {
  // A single microtask detects already-settled promises without delaying the
  // initial ready frame behind disk I/O.
  await Promise.resolve();
  return session.getHistoryMetadata();
}

async function waitForHistoryReady(
  session: AgentSession,
  signal: AbortSignal
): Promise<HistoryLoadMetadata | 'aborted'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: HistoryLoadMetadata | 'aborted') => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(status);
    };
    const onAbort = () => finish('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    void session.historyReady.then(
      () => finish(session.getHistoryMetadata()),
      (error) => finish({ status: 'error', truncated: false, error: error instanceof Error ? error.message : String(error) })
    );
    if (signal.aborted) finish('aborted');
  });
}

function validateCommandScope(
  ctx: AttachmentContext,
  msg: Exclude<ClientMessage, ClientHello | { type: 'list_sessions' } | { type: 'session_close' }>,
  currentGeneration: number,
): string | undefined {
  const scoped = msg.attachId !== undefined || msg.sessionId !== undefined;
  if (scoped) {
    if (msg.attachId !== undefined && msg.attachId !== ctx.attachId) return 'Stale attachment command rejected';
    if (msg.sessionId !== undefined && msg.sessionId !== ctx.sessionId) return 'Stale session command rejected';
    return undefined;
  }
  // Old clients did not scope commands. Keep their first, unswitched
  // attachment usable, but never guess once this socket has changed targets.
  if (ctx.attachId !== undefined || currentGeneration !== 1) {
    return 'Unscoped session command rejected after attachment switch';
  }
  return undefined;
}

function dedupeEvents(events: SessionEvent[], afterId: number): SessionEvent[] {
  const byId = new Map<number, SessionEvent>();
  for (const event of events) {
    if (event.id > afterId) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function isReplayTruncated(events: SessionEvent[], afterId: number, lastEventId: number): boolean {
  if (lastEventId <= afterId) return false;
  if (events.length === 0) return true;
  return events[0]!.id > afterId + 1;
}

export function resolveHelloSession(
  sm: SessionManager,
  msg: ClientHello,
  defaultCwd: string,
  nodes = new NodeRegistry(defaultCwd),
  user: CcwUser = tokenAdmin(defaultCwd)
): HelloResolution {
  const scoped = user.via === 'cookie';

  // A live runtime id is the source of truth. Look it up before applying the
  // hello defaults so Mobile and older clients can attach to Codex sessions
  // without redundantly sending provider/node on every switch.
  if (msg.sessionId) {
    const existing = sm.get(msg.sessionId);
    // A foreign session id behaves exactly like a missing one: fall through to
    // the recover/create path inside the caller's own workspace.
    const visible = existing && (!scoped || user.isAdmin || sm.ownerOf(existing.id) === user.openId);
    if (existing && visible) {
      const state = existing.getState();
      if (msg.nodeId !== undefined && state.nodeId !== msg.nodeId) {
        throw new Error(`Session belongs to ${state.nodeId}/${state.provider}, not ${msg.nodeId}/${msg.provider ?? state.provider}`);
      }
      if (msg.provider !== undefined && state.provider !== msg.provider) {
        throw new Error(`Session belongs to ${state.nodeId}/${state.provider}, not ${msg.nodeId ?? state.nodeId}/${msg.provider}`);
      }
      const requestedCursor = validCursor(msg.lastEventId) ? msg.lastEventId! : 0;
      let replayMode: ReplayMode = requestedCursor > 0 && requestedCursor <= state.lastEventId ? 'delta' : 'full';
      if (replayMode === 'delta') {
        const available = existing.replay(requestedCursor);
        if (isReplayTruncated(available, requestedCursor, state.lastEventId)) replayMode = 'full';
      }
      return { session: existing, replayAfterId: requestedCursor, replayMode, recovered: false };
    }
  }

  const requestedNodeId = msg.nodeId ?? DEFAULT_NODE_ID;
  const requestedProvider = msg.provider ?? DEFAULT_AGENT_PROVIDER;
  const node = nodes.get(requestedNodeId);
  if (!node) throw new Error(`Node ${requestedNodeId} is not configured`);
  if (!node.providers.includes(requestedProvider)) {
    throw new Error(`${node.label} does not provide ${requestedProvider}`);
  }
  if (node.kind !== 'local') {
    throw new Error(`SSH node ${node.label} is configured, but remote execution is not wired in this build yet`);
  }

  const rawCwd = msg.cwd ?? (scoped ? user.workspaceRoot : node.defaultCwd ?? defaultCwd);
  const cwd = scoped ? resolveScoped(rawCwd, user) : rawCwd;
  const reusable = sm.findReusableResume({
    nodeId: requestedNodeId,
    provider: requestedProvider,
    cwd,
    providerSessionId: msg.resumeClaudeId,
    claudeAuthMode: requestedProvider === 'claude' ? (msg.claudeAuthMode ?? defaultClaudeAuthMode()) : undefined,
    viewerMode: msg.viewerMode,
    owner: scoped ? user.openId : undefined,
  });
  if (reusable) {
    return {
      session: reusable,
      // Compatibility only. attach() deliberately ignores this cursor because
      // the requested runtime wrapper was not the exact live wrapper found.
      replayAfterId: validCursor(msg.lastEventId) ? msg.lastEventId! : 0,
      replayMode: 'full',
      recovered: !!msg.sessionId,
    };
  }
  const session = sm.create({
    nodeId: requestedNodeId,
    nodeLabel: node.label,
    provider: requestedProvider,
    cwd,
    resume: msg.resumeClaudeId,
    model: msg.model ?? defaultModelForProvider(requestedProvider),
    claudeAuthMode: requestedProvider === 'claude' ? resolveClaudeAuthMode(msg.claudeAuthMode) : undefined,
    permissionMode: msg.permissionMode,
    viewerMode: msg.viewerMode,
    searchRoot: user.fsRoot || undefined,
    gitIdentity: gitIdentityFor(user),
    owner: scoped ? user.openId : undefined,
  });
  return {
    session,
    // Compatibility only; runtime full replay starts from zero.
    replayAfterId: validCursor(msg.lastEventId) ? msg.lastEventId! : 0,
    replayMode: 'full',
    recovered: !!msg.sessionId,
  };
}

function validCursor(value: number | undefined): boolean {
  return Number.isSafeInteger(value) && value! >= 0;
}

function resolveClaudeAuthMode(requested?: ClientHello['claudeAuthMode']): ClientHello['claudeAuthMode'] {
  const mode = requested ?? defaultClaudeAuthMode();
  if (mode === 'api' && !hasClaudeApiKey()) {
    throw new Error('Claude API fallback is not configured on this server.');
  }
  return mode;
}

// Cookie-authed teammates commit under their own name; token auth (the box
// owner via CLI) keeps the server's existing git config untouched.
function gitIdentityFor(user: CcwUser): { name: string; email: string } | undefined {
  if (user.via !== 'cookie') return undefined;
  return {
    name: user.name || user.slug,
    email: user.email || `${user.slug}@ccw.fa-fa.ai`,
  };
}
