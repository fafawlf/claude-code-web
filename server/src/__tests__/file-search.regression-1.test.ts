import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchProjectFiles } from '../api.js';

// Regression: ISSUE-005 — each mention keystroke could start an unbounded recursive scan
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('file search returns matching relative paths inside its budget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-search-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'session.ts'), 'export {};');
    writeFileSync(join(root, 'README.md'), '# project');

    const result = await searchProjectFiles(root, 'session', 30);

    assert.deepEqual(result.results, ['src/session.ts']);
    assert.equal(result.truncated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('file search stops when its time budget is exhausted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-search-'));
  let tick = 0;
  try {
    writeFileSync(join(root, 'session.ts'), 'export {};');

    const result = await searchProjectFiles(root, 'session', 30, {
      timeBudgetMs: 50,
      now: () => tick++ * 100,
    });

    assert.deepEqual(result.results, []);
    assert.equal(result.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
