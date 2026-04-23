import type { FastifyInstance } from 'fastify';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { timingSafeEqualStr } from './auth.js';

export function registerApi(app: FastifyInstance, token: string, defaultCwd: string) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const provided = (req.query as { t?: string } | undefined)?.t ?? '';
    if (!provided || !timingSafeEqualStr(provided, token)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/api/sessions', async (req) => {
    const q = req.query as { cwd?: string; limit?: string } | undefined;
    const sessions = await listSessions({
      dir: q?.cwd ?? defaultCwd,
      limit: q?.limit ? Number(q.limit) : 30,
    });
    return { sessions };
  });

  app.get('/api/info', async () => ({ cwd: defaultCwd }));
}
