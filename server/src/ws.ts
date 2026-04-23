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
    let unsubEvents: (() => void) | undefined;
    let unsubState: (() => void) | undefined;

    const attach = (s: ClaudeSession, afterId: number) => {
      session = s;
      const replay = s.replay(afterId);
      for (const ev of replay) send(socket, { type: 'sdk_event', id: ev.id, event: ev.event });
      unsubEvents = s.subscribe((ev) => send(socket, { type: 'sdk_event', id: ev.id, event: ev.event }));
      unsubState = s.subscribeState((delta) => send(socket, { type: 'state_update', state: delta }));
      send(socket, { type: 'ready', state: s.getState() });
    };

    const detach = () => {
      unsubEvents?.(); unsubEvents = undefined;
      unsubState?.(); unsubState = undefined;
    };

    socket.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch {
        return send(socket, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.type === 'hello') {
        detach();
        if (msg.sessionId) {
          const existing = sm.get(msg.sessionId);
          if (!existing) return send(socket, { type: 'error', message: 'Session not found' });
          attach(existing, msg.lastEventId ?? 0);
        } else {
          try {
            const s = sm.create({
              cwd: msg.cwd ?? defaultCwd,
              resume: msg.resumeClaudeId,
              model: msg.model,
              permissionMode: msg.permissionMode,
              onPermission: (pr) => send(socket, { type: 'permission_request', ...pr }),
              onPlan: (pr) => send(socket, { type: 'plan_proposed', reqId: pr.reqId, plan: pr.plan }),
            });
            attach(s, 0);
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
