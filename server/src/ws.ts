import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type { SessionManager } from './session/SessionManager.js';
import type { ClaudeSession } from './session/ClaudeSession.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
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
    let unsubscribe: (() => void) | undefined;

    const attach = (s: ClaudeSession, afterId: number) => {
      session = s;
      const replay = s.replay(afterId);
      for (const ev of replay) send(socket, { type: 'sdk_event', id: ev.id, event: ev.event });
      unsubscribe = s.subscribe((ev) => send(socket, { type: 'sdk_event', id: ev.id, event: ev.event }));
      send(socket, { type: 'ready', sessionId: s.id });
    };

    socket.on('message', async (raw: RawData) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch {
        return send(socket, { type: 'error', message: 'Invalid JSON' });
      }

      if (msg.type === 'hello') {
        if (msg.sessionId) {
          const existing = sm.get(msg.sessionId);
          if (!existing) return send(socket, { type: 'error', message: 'Session not found' });
          attach(existing, msg.lastEventId ?? 0);
        } else {
          try {
            const s = sm.create({
              cwd: msg.cwd ?? defaultCwd,
              resume: msg.resumeClaudeId,
              onPermission: (pr) => {
                const payload: ServerMessage = {
                  type: 'permission_request',
                  reqId: pr.reqId,
                  toolName: pr.toolName,
                  input: pr.input,
                  title: pr.title,
                  displayName: pr.displayName,
                  description: pr.description,
                };
                return send(socket, payload);
              },
            });
            attach(s, 0);
          } catch (e) {
            return send(socket, { type: 'error', message: (e as Error).message });
          }
        }
        return;
      }

      if (!session) return send(socket, { type: 'error', message: 'Say hello first' });

      if (msg.type === 'user') {
        session.sendUser(msg.text);
      } else if (msg.type === 'permission_response') {
        session.broker.resolve(msg.reqId, { decision: msg.decision, scope: msg.scope });
      } else if (msg.type === 'interrupt') {
        await session.interrupt();
      }
    });

    socket.on('close', () => {
      unsubscribe?.();
      // Keep the session alive — a reconnect can reattach with lastEventId.
    });
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
