import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactUrl, compactArtifactPath, findArtifactPaths, isArtifactPath } from '../artifacts';
import { setApiToken } from '../api';

test('findArtifactPaths detects generated project artifact paths', () => {
  const text = '📁 文件位置：.claudecode-web/uploads/2026-04-24/output/FlowGPT-SAR-Revised-v3.xlsx';
  const matches = findArtifactPaths(text);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, '.claudecode-web/uploads/2026-04-24/output/FlowGPT-SAR-Revised-v3.xlsx');
});

test('findArtifactPaths trims punctuation and ignores urls', () => {
  assert.equal(findArtifactPaths('See output/report.pdf.')[0].path, 'output/report.pdf');
  assert.deepEqual(findArtifactPaths('https://example.com/output/report.pdf'), []);
});

test('findArtifactPaths detects absolute project paths with spaces', () => {
  const matches = findArtifactPaths('已生成 Word 文档，路径为：/root/random shit/hi.docx，内容为 "hi"。');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, '/root/random shit/hi.docx');
  assert.equal(isArtifactPath('/root/random shit/hi.docx'), true);
});

test('artifact helpers build file URLs and compact labels', () => {
  assert.equal(isArtifactPath('@output/report.xlsx'), true);
  setApiToken('tok');
  try {
    assert.equal(artifactUrl({ cwd: '/root/app', path: '@output/report.xlsx', download: true }), '/api/file?cwd=%2Froot%2Fapp&path=output%2Freport.xlsx&download=1&t=tok');
    setApiToken(null);
    assert.equal(artifactUrl({ cwd: '/root/app', path: '@output/report.xlsx' }), '/api/file?cwd=%2Froot%2Fapp&path=output%2Freport.xlsx');
  } finally {
    setApiToken(null);
  }
  assert.equal(compactArtifactPath('.claudecode-web/uploads/2026-04-24/output/FlowGPT-SAR-Revised-v3.xlsx'), '.claudecode-web.../2026-04-24/output/FlowGPT-SAR-Revised-v3.xlsx');
});
