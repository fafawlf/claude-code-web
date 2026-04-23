import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { SessionManager } from './session/SessionManager.js';
import type { ClaudeSession } from './session/ClaudeSession.js';
import type { ClientMessage, ServerMessage, PermissionMode } from './protocol.js';
import { timingSafeEqualStr } from './auth.js';

export function registerWs(app: FastifyInstance, sm: SessionManager, token: string, defaultCwd: string) {
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const provided = (req.query as { t?: string } | undefined)?.t ?? '';
    if (!provided || !timingSafeEqualStr(provided, token)) {
      send(socket, { type: 'error', message: 'Unauthorized' });
      socket.close(1008, 'Unauthorized');
      return;
    }

    let session: ClaudeSession | undefined;
    let attachedId: string | undefined;
    let unsubEvents: (() => void) | undefined;
    let unsubState: (() => void) | undefined;

    const detach = () => {
      unsubEvents?.(); unsubEvents = undefined;
      unsubState?.(); unsubState = undefined;
      if (attachedId) sm.detach(attachedId);
      session = undefined;
      attachedId = undefined;
    };

    const attach = async (s: ClaudeSession, afterId: number) => {
      session = s;
      attachedId = s.id;
      sm.attach(s.id);
      // Deliver the ready frame FIRST so the client can reset its view.
      send(socket, { type: 'ready', state: s.getState() });
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
    };

    socket.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch {
        return send(socket, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.type === 'hello') {
        // Switching sessions: detach from the prior, and if this WS was the
        // only subscriber AND it's different from the target, close the prior
        // to free the slot (single-user, single-browser assumption).
        const priorId = attachedId;
        detach();
        if (priorId && priorId !== msg.sessionId) {
          await sm.remove(priorId).catch(() => {});
        }

        if (msg.sessionId) {
          const existing = sm.get(msg.sessionId);
          if (!existing) return send(socket, { type: 'error', message: 'Session not found' });
          await attach(existing, msg.lastEventId ?? 0);
        } else {
          try {
            const s = sm.create({
              cwd: msg.cwd ?? defaultCwd,
              resume: msg.resumeClaudeId,
              model: msg.model,
              permissionMode: msg.permissionMode,
              viewerMode: msg.viewerMode,
              onPermission: (pr) => send(socket, { type: 'permission_request', ...pr }),
              onPlan: (pr) => send(socket, { type: 'plan_proposed', reqId: pr.reqId, plan: pr.plan }),
            });
            await attach(s, 0);
          } catch (e) {
            return send(socket, { type: 'error', message: (e as Error).message });
          }
        }
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

    socket.on('close', () => { detach(); });
  });
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
