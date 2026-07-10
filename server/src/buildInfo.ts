import type { FastifyInstance } from 'fastify';

export type BuildInfo = {
  commit: string;
  branch: string;
  builtAt: string;
};

export function buildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    commit: cleanBuildValue(env.CCW_BUILD_SHA, 'unknown'),
    branch: cleanBuildValue(env.CCW_BUILD_BRANCH, 'unknown'),
    builtAt: cleanBuildValue(env.CCW_BUILD_TIME, 'unknown'),
  };
}

export function registerHealthRoute(app: FastifyInstance, build = buildInfoFromEnv()): void {
  app.get('/healthz', async () => ({ ok: true, build }));
}

function cleanBuildValue(value: string | undefined, fallback: string): string {
  const cleaned = value?.trim().replace(/[\r\n]/g, '').slice(0, 128);
  return cleaned || fallback;
}
