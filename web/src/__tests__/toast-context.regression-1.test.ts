import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression: QA-WS-002 — every toast changed the context object and rebuilt the WebSocket.
// Found by /qa on 2026-07-10.
test('ToastProvider memoizes its context value', async () => {
  const source = await readFile(new URL('../components/Toast.tsx', import.meta.url), 'utf8');
  assert.match(source, /useMemo<Ctx>\(\(\) => \(\{ push \}\), \[push\]\)/);
  assert.match(source, /ToastCtx\.Provider value=\{value\}/);
  assert.doesNotMatch(source, /ToastCtx\.Provider value=\{\{ push \}\}/);
});
