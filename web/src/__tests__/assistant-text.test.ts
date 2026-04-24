import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAssistantText, cleanStreamingAssistantText } from '../assistantText';

test('cleanAssistantText removes local model switch stdout without dropping real text', () => {
  assert.equal(
    cleanAssistantText('<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>\n\nReady.'),
    'Ready.'
  );
  assert.equal(
    cleanAssistantText('Before\n<local-command-stdout>Set model to claude-opus-4-7</local-command-stdout>\nAfter'),
    'Before\nAfter'
  );
});

test('cleanStreamingAssistantText hides an incomplete local model switch tag while streaming', () => {
  assert.equal(
    cleanStreamingAssistantText('<local-command-stdout>Set model to claude-opus'),
    ''
  );
});
