import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { SessionManager } from './session/SessionManager.js';
import type { AgentSession } from './agents/types.js';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type ClientHello, type ClientMessage, type ServerMessage, type PermissionMode } from './protocol.js';
import { timingSafeEqualStr } from './auth.js';

export function registerWs(app: FastifyInstance, sm: SessionManager, token: string, defaultCwd: string) {
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const provided = (req.query as { t?: string } | undefined)?.t ?? '';
    if (!provided || !timingSafeEqualStr(provided, token)) {
      send(socket, { type: 'error', message: 'Unauthorized' });
      socket.close(1008, 'Unauthorized');
      return;
    }

    let session: AgentSession | undefined;
    let attachedId: string | undefined;
    let unsubEvents: (() => void) | undefined;
    let unsubState: (() => void) | undefined;
    let unsubControls: (() => void) | undefined;
    const unsubManager = sm.subscribe((sessions) => send(socket, { type: 'sessions_update', sessions }));
    const heartbeat = setInterval(() => {
      const now = Date.now();
      const snapshot = attachedId ? sm.getSnapshot(attachedId) : undefined;
      send(socket, {
        type: 'heartbeat',
        now,
        session: snapshot,
        noActivityMs: snapshot ? Math.max(0, now - snapshot.lastEventAt) : undefined,
      });
      send(socket, { type: 'sessions_update', sessions: sm.listSnapshots() });
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
      await s.historyReady;
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
          const resolved = resolveHelloSession(sm, msg, defaultCwd);
          await attach(resolved.session, resolved.replayAfterId);
        } catch (e) {
          return send(socket, { type: 'error', message: (e as Error).message });
        }
        return;
      }

      if (msg.type === 'session_close') {
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

export function resolveHelloSession(sm: SessionManager, msg: ClientHello, defaultCwd: string): { session: AgentSession; replayAfterId: number; recovered: boolean } {
  const requestedNodeId = msg.nodeId ?? DEFAULT_NODE_ID;
  const requestedProvider = msg.provider ?? DEFAULT_AGENT_PROVIDER;
  if (msg.sessionId) {
    const existing = sm.get(msg.sessionId);
    if (existing) {
      const state = existing.getState();
      if (state.nodeId !== requestedNodeId || state.provider !== requestedProvider) {
        throw new Error(`Session belongs to ${state.nodeId}/${state.provider}, not ${requestedNodeId}/${requestedProvider}`);
      }
      return { session: existing, replayAfterId: msg.lastEventId ?? 0, recovered: false };
    }
  }
  const session = sm.create({
    nodeId: requestedNodeId,
    provider: requestedProvider,
    cwd: msg.cwd ?? defaultCwd,
    resume: msg.resumeClaudeId,
    model: msg.model,
    permissionMode: msg.permissionMode,
    viewerMode: msg.viewerMode,
  });
  return { session, replayAfterId: 0, recovered: !!msg.sessionId };
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
