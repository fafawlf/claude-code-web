import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHideToolInTranscript } from '../toolDisplay';
import type { ChatItem } from '../types';

function tool(name: string, result?: { content: string; isError: boolean }): ChatItem {
  return {
    kind: 'tool_use',
    id: `id-${name}`,
    toolUseId: `tu-${name}`,
    name,
    input: name === 'Bash' ? { command: 'ls' } : { file_path: '/tmp/a.ts' },
    result,
  };
}

test('successful non-edit tools are hidden from the final transcript', () => {
  assert.equal(shouldHideToolInTranscript(tool('Bash', { content: 'ok', isError: false })), true);
  assert.equal(shouldHideToolInTranscript(tool('Read', { content: 'file', isError: false })), true);
  assert.equal(shouldHideToolInTranscript(tool('Grep', { content: 'matches', isError: false })), true);
});

test('running tools, failed tools, and diffs remain visible', () => {
  assert.equal(shouldHideToolInTranscript(tool('Bash')), false);
  assert.equal(shouldHideToolInTranscript(tool('Bash', { content: 'exit 1', isError: true })), false);
  assert.equal(shouldHideToolInTranscript(tool('Edit', { content: 'done', isError: false })), false);
  assert.equal(shouldHideToolInTranscript(tool('Write', { content: 'done', isError: false })), false);
});
