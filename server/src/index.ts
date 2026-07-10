import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { SessionManager } from './session/SessionManager.js';
import { registerWs } from './ws.js';
import { registerApi } from './api.js';
import { NodeRegistry } from './nodes/NodeRegistry.js';
import { tokenModeConfig, type CcwConfig } from './config.js';
import { UserRegistry } from './users/registry.js';
import { FeishuClient } from './auth/feishu.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerUsageRoutes } from './usage/routes.js';
import { resolveUser, type IdentityContext } from './users/identity.js';
import { registerHealthRoute } from './buildInfo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type StartOptions = {
  host?: string;
  port: number;
  token: string;
  defaultCwd: string;
  config?: CcwConfig;
};

export async function startServer(opts: StartOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });
  const config = opts.config ?? tokenModeConfig();
  const feishuMode = config.authMode === 'feishu';

  let registry: UserRegistry | undefined;
  if (feishuMode) {
    registry = new UserRegistry(config.usersFile, config.adminEmails, config.allowedEmailDomains, config.trustAllFeishu);
    registry.load();
  }
  const identity = { config, registry };
  const idCtx: IdentityContext = { token: opts.token, defaultCwd: opts.defaultCwd, config, registry };

  // A shared Max subscription serves the whole team in feishu mode, so allow
  // more parallel sessions overall but keep any one person from hogging them.
  const sm = feishuMode
    ? new SessionManager(undefined, { global: 24, perOwner: 3 })
    : new SessionManager();
  const nodes = new NodeRegistry(opts.defaultCwd);

  await app.register(fastifyWebsocket);

  if (feishuMode) {
    registerAuthRoutes(app, { config, registry: registry!, feishu: new FeishuClient(config.feishu!) });
  }

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

  registerHealthRoute(app);

  // Used by the SPA to confirm its credential (token or cookie) is valid.
  app.get('/auth-check', async (req, reply) => {
    const user = resolveUser(req, idCtx);
    if (!user) return reply.code(401).send({ ok: false, authMode: config.authMode });
    return { ok: true, authMode: config.authMode };
  });

  registerApi(app, opts.token, opts.defaultCwd, sm, nodes, { host: opts.host, port: opts.port }, identity);
  registerUsageRoutes(app, identity);
  registerWs(app, sm, opts.token, opts.defaultCwd, nodes, identity);

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
