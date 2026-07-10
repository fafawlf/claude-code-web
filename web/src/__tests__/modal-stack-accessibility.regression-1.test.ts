import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blocksGlobalAppShortcuts,
  resolveTopLevelModal,
} from '../hooks/useModalLayer';

// Regression: QA-A11Y-001 — stacked dialogs let background shortcuts replace the active modal
// Found by /qa on 2026-07-10
test('blocking dialogs win the single top-level modal slot', () => {
  assert.equal(resolveTopLevelModal({ setup: true, permission: true, plan: true, project: true, palette: true }), 'setup');
  assert.equal(resolveTopLevelModal({ setup: false, permission: true, plan: true, project: true, palette: true }), 'permission');
  assert.equal(resolveTopLevelModal({ setup: false, permission: false, plan: true, project: true, palette: true }), 'plan');
  assert.equal(resolveTopLevelModal({ setup: false, permission: false, plan: false, project: true, palette: true }), 'project');
  assert.equal(resolveTopLevelModal({ setup: false, permission: false, plan: false, project: false, palette: true }), 'palette');
  assert.equal(resolveTopLevelModal({ setup: false, permission: false, plan: false, project: false, palette: false }), null);
});

test('permission, plan, and setup dialogs block global app shortcuts', () => {
  assert.equal(blocksGlobalAppShortcuts('setup'), true);
  assert.equal(blocksGlobalAppShortcuts('permission'), true);
  assert.equal(blocksGlobalAppShortcuts('plan'), true);
  assert.equal(blocksGlobalAppShortcuts('palette'), true);
  assert.equal(blocksGlobalAppShortcuts('project'), true);
  assert.equal(blocksGlobalAppShortcuts(null), false);
});

test('the app renders only the resolved modal and isolates its background', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(source, /useModalBackground\(backgroundRef,\s*activeModal !== null\)/);
  assert.match(source, /blocksGlobalAppShortcuts\(activeModal\)/);
  assert.match(source, /activeModal === 'permission'/);
  assert.match(source, /activeModal === 'plan'/);
  assert.match(source, /activeModal === 'setup'/);
  assert.match(source, /aria-hidden=\{activeModal !== null \? true : undefined\}/);
});
