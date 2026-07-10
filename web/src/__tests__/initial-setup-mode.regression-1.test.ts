import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferPreferredMode } from '../components/InitialSetup';

// Regression: ISSUE-007 — localhost setup defaulted to remote server mode
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-claude-fa-fa-ai-2026-07-10.md
test('setup infers local mode for loopback hosts and remote mode elsewhere', () => {
  assert.equal(inferPreferredMode(null, 'localhost'), 'local');
  assert.equal(inferPreferredMode(null, '127.0.0.1'), 'local');
  assert.equal(inferPreferredMode(null, '[::1]'), 'local');
  assert.equal(inferPreferredMode(null, 'claude.fa-fa.ai'), 'remote');
});

test('an explicit saved setup mode wins over hostname inference', () => {
  assert.equal(inferPreferredMode('remote', 'localhost'), 'remote');
  assert.equal(inferPreferredMode('local', 'claude.fa-fa.ai'), 'local');
});
