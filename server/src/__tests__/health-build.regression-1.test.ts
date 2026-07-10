import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildInfoFromEnv, registerHealthRoute } from '../buildInfo.js';

// Regression: ISSUE-010 — production health checks could not identify the deployed commit
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('healthz exposes deterministic build provenance', async () => {
  const app = Fastify({ logger: false });
  registerHealthRoute(app, {
    commit: 'abc1234',
    branch: 'multi-user',
    builtAt: '2026-07-10T03:30:00Z',
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      build: { commit: 'abc1234', branch: 'multi-user', builtAt: '2026-07-10T03:30:00Z' },
    });
  } finally {
    await app.close();
  }
});

test('build metadata sanitizes environment values and defaults missing fields', () => {
  assert.deepEqual(buildInfoFromEnv({
    CCW_BUILD_SHA: ' abc\n123 ',
    CCW_BUILD_BRANCH: 'fix/session',
  }), {
    commit: 'abc123',
    branch: 'fix/session',
    builtAt: 'unknown',
  });
});
