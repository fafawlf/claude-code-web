import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { codeTextFromChildren, languageFromClassName } from '../components/CodeBlock';

(globalThis as unknown as { React: typeof React }).React = React;

test('MarkdownMessage renders common markdown instead of raw markdown markers', () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: [
      '# Title',
      '',
      '- one',
      '- **two**',
      '',
      '> quoted',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Use `npm test`.',
    ].join('\n'),
  }));

  assert.match(html, /<h1/);
  assert.match(html, /<ul/);
  assert.match(html, /<strong/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<table/);
  assert.match(html, /npm test/);
  assert.doesNotMatch(html, /# Title/);
  assert.doesNotMatch(html, /\*\*two\*\*/);
});

test('MarkdownMessage renders fenced code with a language toolbar and copy action', () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: '```ts\nconst x = 1;\n```',
  }));

  assert.match(html, />ts</);
  assert.match(html, /Copy code/);
  assert.match(html, /const x = 1;/);
});

test('MarkdownMessage tolerates incomplete streaming markdown', () => {
  assert.doesNotThrow(() => {
    renderToStaticMarkup(createElement(MarkdownMessage, {
      text: '```ts\nconst unfinished = true',
      streaming: true,
    }));
  });
});

test('MarkdownMessage turns artifact paths into open and download links', () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: 'Excel 已生成完毕 ✅\n\n📁 文件位置：.claudecode-web/uploads/2026-04-24/output/FlowGPT-SAR-Revised-v3.xlsx',
    token: 'tok',
    cwd: '/root/chatgpt',
  }));

  assert.match(html, /\/api\/file\?t=tok&amp;cwd=%2Froot%2Fchatgpt&amp;path=\.claudecode-web%2Fuploads%2F2026-04-24%2Foutput%2FFlowGPT-SAR-Revised-v3\.xlsx/);
  assert.match(html, /download=1/);
  assert.match(html, /Download/);
});

test('MarkdownMessage turns absolute artifact paths with spaces into links', () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: '已生成 Word 文档，路径为：/root/random shit/hi.docx，内容为 "hi"。',
    token: 'tok',
    cwd: '/root/random shit',
  }));

  assert.match(html, /\/api\/file\?t=tok&amp;cwd=%2Froot%2Frandom\+shit&amp;path=%2Froot%2Frandom\+shit%2Fhi\.docx/);
  assert.match(html, /download=1/);
  assert.match(html, /hi\.docx/);
});

test('CodeBlock helpers preserve raw code text and language labels', () => {
  assert.equal(languageFromClassName('language-ts extra'), 'ts');
  assert.equal(languageFromClassName('lang-shell'), 'shell');
  assert.equal(codeTextFromChildren(['const a = 1;\n']), 'const a = 1;');
});
