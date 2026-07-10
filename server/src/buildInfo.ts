import type { FastifyInstance } from 'fastify';

export type BuildInfo = {
  commit: string;
  branch: string;
  builtAt: string;
};

export type RuntimeHealth = {
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopLagMs: number;
};

let lastLoopTick = performance.now();
let currentLoopLagMs = 0;
const loopLagTimer = setInterval(() => {
  const now = performance.now();
  currentLoopLagMs = Math.max(0, now - lastLoopTick - 1_000);
  lastLoopTick = now;
}, 1_000);
loopLagTimer.unref?.();

export function buildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    commit: cleanBuildValue(env.CCW_BUILD_SHA, 'unknown'),
    branch: cleanBuildValue(env.CCW_BUILD_BRANCH, 'unknown'),
    builtAt: cleanBuildValue(env.CCW_BUILD_TIME, 'unknown'),
  };
}

export function runtimeHealthSnapshot(): RuntimeHealth {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    eventLoopLagMs: Math.round(currentLoopLagMs * 10) / 10,
  };
}

export function registerHealthRoute(
  app: FastifyInstance,
  build = buildInfoFromEnv(),
  runtime = runtimeHealthSnapshot,
): void {
  app.get('/healthz', async () => ({ ok: true, build, runtime: runtime() }));
}

function cleanBuildValue(value: string | undefined, fallback: string): string {
  const cleaned = value?.trim().replace(/[\r\n]/g, '').slice(0, 128);
  return cleaned || fallback;
}
