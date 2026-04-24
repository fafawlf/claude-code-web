import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPromptDraft, readPromptDraft, writePromptDraft, type DraftStorageLike } from '../promptDraft';

class MemoryStorage implements DraftStorageLike {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('prompt drafts are scoped by project cwd', () => {
  const storage = new MemoryStorage();
  writePromptDraft('/root/random shit', 'unfinished prompt', storage);
  writePromptDraft('/root/chatgpt', 'other draft', storage);

  assert.equal(readPromptDraft('/root/random shit', storage), 'unfinished prompt');
  assert.equal(readPromptDraft('/root/chatgpt', storage), 'other draft');
});

test('empty prompt draft clears storage', () => {
  const storage = new MemoryStorage();
  writePromptDraft('/root/random shit', 'unfinished prompt', storage);
  writePromptDraft('/root/random shit', '   ', storage);

  assert.equal(readPromptDraft('/root/random shit', storage), '');
});

test('clearPromptDraft removes the current project draft', () => {
  const storage = new MemoryStorage();
  writePromptDraft('/root/random shit', 'unfinished prompt', storage);
  clearPromptDraft('/root/random shit', storage);

  assert.equal(readPromptDraft('/root/random shit', storage), '');
});
