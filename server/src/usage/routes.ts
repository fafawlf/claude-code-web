import type { FastifyInstance } from 'fastify';
import type { CcwConfig } from '../config.js';
import type { UserRegistry } from '../users/registry.js';
import { userOf } from '../api.js';
import { getSharedUsage } from './anthropicUsage.js';
import { getPerUserUsage } from './localUsage.js';

export type UsageRoutesOptions = {
  config: CcwConfig;
  registry?: UserRegistry;
};

/** Usage visibility + admin user management. Must be registered after
 *  registerApi so the /api auth hook covers these routes. */
export function registerUsageRoutes(app: FastifyInstance, opts: UsageRoutesOptions): void {
  const { config, registry } = opts;

  app.get('/api/usage', async (req) => {
    userOf(req); // any authenticated user
    const shared = await getSharedUsage();
    if (!registry) return { shared, perUser: [] };
    const users = registry.list();
    const perUser = await getPerUserUsage(config.usersRoot, users.map((u) => u.slug));
    const named = perUser.map((u) => ({
      ...u,
      name: users.find((x) => x.slug === u.slug)?.name ?? u.slug,
    }));
    return { shared, perUser: named };
  });

  app.get('/api/admin/users', async (req, reply) => {
    const user = userOf(req);
    if (!user.isAdmin) return reply.code(403).send({ error: 'Admins only' });
    if (!registry) return { users: [], allowlist: [] };
    return {
      users: registry.list().map(({ openId, email, name, slug, role, createdAt, lastLoginAt, disabled }) => ({
        openId, email, name, slug, role, createdAt, lastLoginAt, disabled: !!disabled,
      })),
      allowlist: registry.allowlist(),
      adminEmails: config.adminEmails,
    };
  });

  app.post('/api/admin/allowlist', async (req, reply) => {
    const user = userOf(req);
    if (!user.isAdmin) return reply.code(403).send({ error: 'Admins only' });
    if (!registry) return reply.code(400).send({ error: 'feishu mode is not enabled' });
    const body = req.body as { entry?: string; remove?: boolean } | undefined;
    if (!body?.entry?.trim()) return reply.code(400).send({ error: 'entry required' });
    try {
      if (body.remove) registry.removeFromAllowlist(body.entry);
      else registry.addToAllowlist(body.entry);
      return { ok: true, allowlist: registry.allowlist() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/admin/user', async (req, reply) => {
    const user = userOf(req);
    if (!user.isAdmin) return reply.code(403).send({ error: 'Admins only' });
    if (!registry) return reply.code(400).send({ error: 'feishu mode is not enabled' });
    const body = req.body as { openId?: string; role?: 'admin' | 'user'; disabled?: boolean } | undefined;
    if (!body?.openId) return reply.code(400).send({ error: 'openId required' });
    if (body.openId === user.openId && (body.disabled === true || body.role === 'user')) {
      return reply.code(400).send({ error: 'You cannot demote or disable yourself' });
    }
    try {
      if (body.role) registry.setRole(body.openId, body.role);
      if (body.disabled !== undefined) registry.setDisabled(body.openId, body.disabled);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
