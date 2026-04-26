import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { SessionManager } from './session/SessionManager.js';
import { registerWs } from './ws.js';
import { registerApi } from './api.js';
import { timingSafeEqualStr } from './auth.js';
import { NodeRegistry } from './nodes/NodeRegistry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type StartOptions = {
  host?: string;
  port: number;
  token: string;
  defaultCwd: string;
};

export async function startServer(opts: StartOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  const sm = new SessionManager();
  const nodes = new NodeRegistry(opts.defaultCwd);

  await app.register(fastifyWebsocket);

  // Find the web bundle: ../../../web/dist from server/dist/src, or ../../web/dist when running built CLI.
  const webDistCandidates = [
    resolve(__dirname, '..', '..', 'web', 'dist'),
    resolve(__dirname, '..', '..', '..', 'web', 'dist'),
    resolve(process.cwd(), 'web', 'dist'),
  ];
  const webDist = webDistCandidates.find((p) => existsSync(p));

  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((_req, reply) => {
      reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send('<h1>claudecode-web</h1><p>Web bundle not built. Run <code>npm run build -w web</code>.</p>');
    });
  }

  app.get('/healthz', async () => ({ ok: true }));

  // Token-gate a small endpoint used by the SPA to confirm the token is valid.
  app.get('/auth-check', async (req, reply) => {
    const provided = (req.query as { t?: string } | undefined)?.t ?? '';
    if (!provided || !timingSafeEqualStr(provided, opts.token)) {
      return reply.code(401).send({ ok: false });
    }
    return { ok: true };
  });

  registerApi(app, opts.token, opts.defaultCwd, sm, nodes, { host: opts.host, port: opts.port });
  registerWs(app, sm, opts.token, opts.defaultCwd, nodes);

  const host = opts.host ?? '127.0.0.1';
  await app.listen({ host, port: opts.port });

  const shutdown = async () => {
    try { await sm.closeAll(); } catch { /* */ }
    try { await app.close(); } catch { /* */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return app;
}
