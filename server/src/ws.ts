import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { SessionManager } from './session/SessionManager.js';
import type { AgentSession } from './agents/types.js';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, defaultModelForProvider, type ClientHello, type ClientMessage, type ServerMessage, type PermissionMode, type SessionStateSnapshot } from './protocol.js';
import { NodeRegistry } from './nodes/NodeRegistry.js';
import { tokenModeConfig, type CcwConfig } from './config.js';
import { resolveScoped, resolveUser, tokenAdmin, type CcwUser, type IdentityContext } from './users/identity.js';
import type { UserRegistry } from './users/registry.js';
import { defaultClaudeAuthMode, hasClaudeApiKey } from './authInfo.js';

export type WsIdentityOptions = {
  config: CcwConfig;
  registry?: UserRegistry;
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
    const user = resolveUser(req, idCtx);
    if (!user) {
      send(socket, { type: 'error', message: 'Unauthorized' });
      socket.close(1008, 'Unauthorized');
      return;
    }
    // SameSite does not cover WebSocket handshakes, so cookie-authenticated
    // sockets must prove they come from our own origin. Token auth (CLI,
    // tunnels, native apps) carries the secret itself and skips this.
    if (user.via === 'cookie') {
      const origin = req.headers.origin;
      if (!origin || !identity.config.publicOrigin || origin !== identity.config.publicOrigin) {
        send(socket, { type: 'error', message: 'Origin not allowed' });
        socket.close(1008, 'Origin not allowed');
        return;
      }
    }
    const visibleSessions = (): SessionStateSnapshot[] =>
      user.via === 'token' || user.isAdmin ? sm.listSnapshots() : sm.listSnapshotsForOwner(user.openId);

    let session: AgentSession | undefined;
    let attachedId: string | undefined;
    let unsubEvents: (() => void) | undefined;
    let unsubState: (() => void) | undefined;
    let unsubControls: (() => void) | undefined;
    const unsubManager = sm.subscribe(() => send(socket, { type: 'sessions_update', sessions: visibleSessions() }));
    const heartbeat = setInterval(() => {
      const now = Date.now();
      const snapshot = attachedId ? sm.getSnapshot(attachedId) : undefined;
      send(socket, {
        type: 'heartbeat',
        now,
        session: snapshot,
        noActivityMs: snapshot ? Math.max(0, now - snapshot.lastEventAt) : undefined,
      });
      send(socket, { type: 'sessions_update', sessions: visibleSessions() });
    }, 5000);

    const detach = () => {
      unsubEvents?.(); unsubEvents = undefined;
      unsubState?.(); unsubState = undefined;
      unsubControls?.(); unsubControls = undefined;
      if (attachedId) sm.detach(attachedId);
      session = undefined;
      attachedId = undefined;
    };

    const sendPending = (s: AgentSession) => {
      for (const control of s.getPendingControls()) {
        send(socket, { type: 'pending_control', sessionId: s.id, control });
        if (control.kind === 'permission') {
          const { kind, ...req } = control;
          send(socket, { type: 'permission_request', ...req });
        } else {
          send(socket, { type: 'plan_proposed', reqId: control.reqId, plan: control.plan });
        }
      }
    };

    const attach = async (s: AgentSession, afterId: number) => {
      session = s;
      attachedId = s.id;
      sm.attach(s.id);
      // Deliver the ready frame FIRST so the client can reset its view.
      send(socket, { type: 'ready', state: sm.getSnapshot(s.id) ?? s.getState() });
      // Wait for the background history load (if any) to finish populating the
      // ring, then flush the whole prior transcript as batched frames. This
      // avoids subscribing early and dribbling 900 history events one by one.
      await waitForHistoryReady(s);
      if (socket.readyState !== socket.OPEN) { sm.detach(s.id); return; }
      const replay = s.replay(afterId);
      if (replay.length > 0) {
        const CHUNK = 250;
        for (let i = 0; i < replay.length; i += CHUNK) {
          send(socket, {
            type: 'sdk_events_batch',
            events: replay.slice(i, i + CHUNK).map((e) => ({ id: e.id, event: e.event })),
          });
        }
      }
      // Only subscribe AFTER history is flushed so live events arrive in order
      // after the batch on the wire.
      unsubEvents = s.subscribe((ev) => send(socket, { type: 'sdk_event', id: ev.id, event: ev.event }));
      unsubState = s.subscribeState((delta) => send(socket, { type: 'state_update', state: delta }));
      unsubControls = s.subscribeControls((control) => {
        send(socket, { type: 'pending_control', sessionId: s.id, control });
        if (control.kind === 'permission') {
          const { kind, ...req } = control;
          send(socket, { type: 'permission_request', ...req });
        } else {
          send(socket, { type: 'plan_proposed', reqId: control.reqId, plan: control.plan });
        }
      });
      sendPending(s);
    };

    socket.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch {
        return send(socket, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.type === 'hello') {
        // Switching sessions only detaches this socket. The previous session
        // keeps running in the background until the user explicitly closes it.
        detach();

        try {
          const resolved = resolveHelloSession(sm, msg, defaultCwd, nodes, user);
          await attach(resolved.session, resolved.replayAfterId);
        } catch (e) {
          return send(socket, { type: 'error', message: (e as Error).message });
        }
        return;
      }

      if (msg.type === 'session_close') {
        if (user.via === 'cookie' && !user.isAdmin && sm.ownerOf(msg.sessionId) !== user.openId) {
          return send(socket, { type: 'error', message: 'Not your session' });
        }
        if (msg.sessionId === attachedId) detach();
        await sm.remove(msg.sessionId).catch((e) => send(socket, { type: 'error', message: (e as Error).message }));
        return;
      }

      if (!session) return send(socket, { type: 'error', message: 'Say hello first' });

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
          catch (e) { send(socket, { type: 'error', message: `setModel failed: ${(e as Error).message}` }); }
          break;
        case 'set_claude_auth_mode':
          try { await session.setClaudeAuthMode(msg.mode); }
          catch (e) { send(socket, { type: 'error', message: `setClaudeAuthMode failed: ${(e as Error).message}` }); }
          break;
        case 'set_permission_mode':
          try { await session.setPermissionMode(msg.mode as PermissionMode); }
          catch (e) { send(socket, { type: 'error', message: `setPermissionMode failed: ${(e as Error).message}` }); }
          break;
        case 'refresh_history':
          await session.refreshHistory();
          break;
      }
    });

    socket.on('close', () => { clearInterval(heartbeat); detach(); unsubManager(); });
  });
}

async function waitForHistoryReady(session: AgentSession): Promise<void> {
  // History replay should usually resolve quickly, but the Claude SDK can
  // occasionally stall while reading an old transcript. In that case, do not
  // leave the browser in a blank read-only state: flush whatever is already in
  // the in-memory ring and subscribe to future events.
  await Promise.race([
    session.historyReady,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

export function resolveHelloSession(
  sm: SessionManager,
  msg: ClientHello,
  defaultCwd: string,
  nodes = new NodeRegistry(defaultCwd),
  user: CcwUser = tokenAdmin(defaultCwd)
): { session: AgentSession; replayAfterId: number; recovered: boolean } {
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
  const scoped = user.via === 'cookie';
  if (msg.sessionId) {
    const existing = sm.get(msg.sessionId);
    // A foreign session id behaves exactly like a missing one: fall through to
    // the recover/create path inside the caller's own workspace.
    const visible = existing && (!scoped || user.isAdmin || sm.ownerOf(existing.id) === user.openId);
    if (existing && visible) {
      const state = existing.getState();
      if (state.nodeId !== requestedNodeId || state.provider !== requestedProvider) {
        throw new Error(`Session belongs to ${state.nodeId}/${state.provider}, not ${requestedNodeId}/${requestedProvider}`);
      }
      return { session: existing, replayAfterId: msg.lastEventId ?? 0, recovered: false };
    }
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
    return { session: reusable, replayAfterId: msg.lastEventId ?? 0, recovered: !!msg.sessionId };
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
  return { session, replayAfterId: msg.lastEventId ?? 0, recovered: !!msg.sessionId };
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

function send(socket: WebSocket, m: ServerMessage): boolean {
  try {
    if (socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(m));
    return true;
  } catch {
    return false;
  }
}
