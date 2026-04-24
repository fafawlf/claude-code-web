import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigatePromptHistory, recordPrompt, shouldHandlePromptHistoryKey } from '../promptHistory';

test('recordPrompt stores trimmed prompts and dedupes older copies', () => {
  assert.deepEqual(recordPrompt(['first', 'second'], ' first '), ['second', 'first']);
  assert.deepEqual(recordPrompt(['a', 'b'], 'c', 2), ['b', 'c']);
  assert.deepEqual(recordPrompt(['a'], '   '), ['a']);
});

test('navigatePromptHistory walks back through prompts and restores the draft', () => {
  const items = ['one', 'two'];
  const first = navigatePromptHistory({ items, cursor: null, draft: '', value: 'draft' }, 'up');
  assert.deepEqual(first, { items, cursor: 1, draft: 'draft', value: 'two' });

  const second = navigatePromptHistory(first!, 'up');
  assert.deepEqual(second, { items, cursor: 0, draft: 'draft', value: 'one' });

  const third = navigatePromptHistory(second!, 'down');
  assert.deepEqual(third, { items, cursor: 1, draft: 'draft', value: 'two' });

  const restored = navigatePromptHistory(third!, 'down');
  assert.deepEqual(restored, { items, cursor: null, draft: '', value: 'draft' });
});

test('prompt history only handles arrows at useful caret positions', () => {
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowUp', text: '', selectionStart: 0, selectionEnd: 0, popupOpen: false }), 'up');
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowUp', text: 'one\ntwo', selectionStart: 1, selectionEnd: 1, popupOpen: false }), 'up');
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowUp', text: 'one\ntwo', selectionStart: 5, selectionEnd: 5, popupOpen: false }), null);
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowDown', text: 'one\ntwo', selectionStart: 7, selectionEnd: 7, popupOpen: false }), 'down');
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowDown', text: 'one\ntwo', selectionStart: 2, selectionEnd: 2, popupOpen: false }), null);
});

test('prompt history does not intercept slash or mention palette arrows', () => {
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowUp', text: '/mo', selectionStart: 3, selectionEnd: 3, popupOpen: true }), null);
  assert.equal(shouldHandlePromptHistoryKey({ key: 'ArrowDown', text: '@src', selectionStart: 4, selectionEnd: 4, popupOpen: true }), null);
});
