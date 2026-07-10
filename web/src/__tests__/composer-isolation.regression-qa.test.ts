import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ComposerScopeStore, composerDraftStorageKey, composerScopeKey } from '../composerScope';

type Attachment = { id: string; name: string };

// QA regression: two sessions in the same cwd must never share draft/history/attachments.
test('[QA] composer state is partitioned by cwd and stable session key', () => {
  const store = new ComposerScopeStore<Attachment>();
  const a = composerScopeKey('/workspace', 'session-a');
  const b = composerScopeKey('/workspace', 'session-b');

  store.save(a, {
    text: 'draft a',
    history: ['prompt a'],
    historyCursor: 0,
    historyDraft: 'history draft a',
    attachments: [{ id: 'a1', name: 'a.txt' }],
  });

  assert.equal(store.read(b), undefined);
  assert.deepEqual(store.read(a), {
    text: 'draft a',
    history: ['prompt a'],
    historyCursor: 0,
    historyDraft: 'history draft a',
    attachments: [{ id: 'a1', name: 'a.txt' }],
  });
  assert.notEqual(composerDraftStorageKey('/workspace', 'session-a'), composerDraftStorageKey('/workspace', 'session-b'));
});

// QA regression: older App builds without sessionKey keep the existing cwd draft key.
test('[QA] composer session key remains backward-compatible when omitted', () => {
  assert.equal(composerScopeKey('/workspace'), '/workspace');
  assert.equal(composerDraftStorageKey('/workspace'), '/workspace');
});

test('[QA] App scopes the composer with the stable display-session identity', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /sessionKey=\{attachment\.displaySessionKey\}/);
  assert.doesNotMatch(app, /<InputBar[\s\S]*?sessionKey=\{activeSessionIdRef\.current\}/);
});
