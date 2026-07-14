import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clearSharedUsageCache, getSharedUsage } from '../usage/anthropicUsage.js';

function credentialsFixture(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-anthropic-usage-'));
  const path = join(dir, '.credentials.json');
  writeFileSync(path, JSON.stringify({
    claudeAiOauth: {
      accessToken: 'test-token',
      expiresAt: Date.now() + 60 * 60_000,
      subscriptionType: 'max',
    },
  }));
  return { dir, path };
}

test('concurrent cache misses share one Anthropic usage request', async () => {
  const fixture = credentialsFixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return Response.json({
      five_hour: { utilization: 12 },
      seven_day: { utilization: 34 },
    });
  };

  try {
    clearSharedUsageCache();
    const results = await Promise.all(Array.from({ length: 10 }, () => getSharedUsage(fixture.path)));
    assert.equal(calls, 1);
    assert.equal(results.every((result) => result.available), true);
  } finally {
    globalThis.fetch = originalFetch;
    clearSharedUsageCache();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('a transient 429 keeps the last successful usage snapshot', async () => {
  const fixture = credentialsFixture();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return Response.json({
        five_hour: { utilization: 21 },
        seven_day: { utilization: 43 },
      });
    }
    return Response.json(
      { error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } },
      { status: 429 },
    );
  };

  try {
    clearSharedUsageCache();
    const fresh = await getSharedUsage(fixture.path);
    now += 6 * 60_000;
    const afterRateLimit = await getSharedUsage(fixture.path);

    assert.equal(calls, 2);
    assert.equal(fresh.available, true);
    assert.equal(afterRateLimit.available, true);
    assert.equal(afterRateLimit.stale, true);
    assert.match(afterRateLimit.reason ?? '', /rate limit/i);
    assert.equal(afterRateLimit.sevenDay?.utilization, 43);
    assert.equal(afterRateLimit.fetchedAt, fresh.fetchedAt);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearSharedUsageCache();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('a transient 429 backs off upstream refreshes for fifteen minutes', async () => {
  const fixture = credentialsFixture();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      { error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } },
      { status: 429 },
    );
  };

  try {
    clearSharedUsageCache();
    const first = await getSharedUsage(fixture.path);
    now += 6 * 60_000;
    const duringBackoff = await getSharedUsage(fixture.path);
    now += 10 * 60_000;
    await getSharedUsage(fixture.path);

    assert.equal(first.temporary, true);
    assert.equal(duringBackoff.temporary, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearSharedUsageCache();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
