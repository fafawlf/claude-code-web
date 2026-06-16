import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolUse } from '../components/ToolUse';

(globalThis as unknown as { React: typeof React }).React = React;

test('Read tool use renders as a compact process row when collapsed', () => {
  const html = renderToStaticMarkup(createElement(ToolUse, {
    item: {
      kind: 'tool_use',
      id: 'item-1',
      toolUseId: 'tool-1',
      name: 'Read',
      input: { file_path: '/srv/ccw/context/log/doc.md' },
    },
  }));

  assert.match(html, /tool-use-compact/);
  assert.match(html, /Read/);
  assert.match(html, /\/srv\/ccw\/context\/log\/doc\.md/);
});

test('Bash tool use keeps the regular card treatment', () => {
  const html = renderToStaticMarkup(createElement(ToolUse, {
    item: {
      kind: 'tool_use',
      id: 'item-2',
      toolUseId: 'tool-2',
      name: 'Bash',
      input: { command: 'npm test' },
    },
  }));

  assert.doesNotMatch(html, /tool-use-compact/);
  assert.match(html, /Bash/);
  assert.match(html, /npm test/);
});
