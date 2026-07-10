import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Regression: the command palette used to rewrite the current title but never
// opened TopBar's private rename input, so the action appeared to do nothing.
test('command palette rename explicitly opens the TopBar editor', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const topBar = readFileSync(new URL('../components/TopBar.tsx', import.meta.url), 'utf8');

  assert.match(app, /setRenameRequest\(\(request\) => request \+ 1\)/);
  assert.match(app, /renameRequest=\{renameRequest\}/);
  assert.match(topBar, /if \(!p\.renameRequest\) return/);
  assert.match(topBar, /setRenaming\(true\)/);
  assert.match(topBar, /aria-label="Rename current session"/);
});
