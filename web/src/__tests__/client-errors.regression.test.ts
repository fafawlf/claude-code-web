import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientErrorReporter, type ClientErrorPayload } from '../clientErrors';

test('browser error reporting sanitizes, deduplicates, and rate limits', async () => {
  const sent: ClientErrorPayload[] = [];
  let now = 1_000;
  const report = createClientErrorReporter((payload) => sent.push(payload), () => now);

  report({ kind: 'error', message: 'broken\nline', source: 'bundle.js?secret=yes', line: -1 });
  report({ kind: 'error', message: 'broken\nline', source: 'bundle.js?secret=yes', line: -1 });
  await Promise.resolve();
  assert.deepEqual(sent, [{
    kind: 'error',
    message: 'broken line',
    source: 'bundle.js',
    line: undefined,
    column: undefined,
  }]);

  now += 11_000;
  report({ kind: 'error', message: 'broken line', source: 'bundle.js?secret=yes' });
  await Promise.resolve();
  assert.equal(sent.length, 2);

  for (let index = 0; index < 20; index++) {
    report({ kind: 'error', message: `unique-${index}` });
  }
  await Promise.resolve();
  assert.equal(sent.length, 10);
});
