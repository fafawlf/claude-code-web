import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentPrompt, formatFileSize, type UploadedFileRef } from '../uploads';

const file: UploadedFileRef = {
  name: 'screenshot.png',
  path: '/root/app/.claudecode-web/uploads/2026-04-24/screenshot.png',
  relativePath: '.claudecode-web/uploads/2026-04-24/screenshot.png',
  mime: 'image/png',
  size: 1536,
};

test('buildAttachmentPrompt appends uploaded file references to user text', () => {
  const prompt = buildAttachmentPrompt('Analyze this UI', [file]);

  assert.match(prompt, /^Analyze this UI/);
  assert.match(prompt, /Uploaded files:/);
  assert.match(prompt, /@\.claudecode-web\/uploads\/2026-04-24\/screenshot\.png/);
  assert.match(prompt, /png, 1.5 KB/);
});

test('buildAttachmentPrompt handles attachment-only sends', () => {
  const prompt = buildAttachmentPrompt('', [file]);

  assert.match(prompt, /^Please inspect these uploaded files:/);
  assert.match(prompt, /@\.claudecode-web\/uploads\/2026-04-24\/screenshot\.png/);
});

test('formatFileSize keeps labels compact', () => {
  assert.equal(formatFileSize(42), '42 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(20 * 1024), '20 KB');
  assert.equal(formatFileSize(3 * 1024 * 1024), '3.0 MB');
});
