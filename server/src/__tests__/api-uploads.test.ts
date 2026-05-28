import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerApi } from '../api.js';
import { SessionManager } from '../session/SessionManager.js';

test('POST /api/uploads stores files under the project upload directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads?t=tok',
      payload: {
        cwd: root,
        files: [{ name: 'hello.txt', mime: 'text/plain', dataBase64: Buffer.from('hello').toString('base64') }],
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { files: Array<{ name: string; path: string; relativePath: string; mime: string; size: number }> };
    assert.equal(body.files.length, 1);
    assert.equal(body.files[0].name, 'hello.txt');
    assert.match(body.files[0].relativePath, /^\.claudecode-web\/uploads\/\d{4}-\d{2}-\d{2}\/hello\.txt$/);
    assert.equal(body.files[0].mime, 'text/plain');
    assert.equal(body.files[0].size, 5);
    assert.equal(readFileSync(body.files[0].path, 'utf8'), 'hello');
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/uploads sanitizes names and avoids overwriting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-upload-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const payload = {
      cwd: root,
      files: [{ name: '../same?.txt', dataBase64: Buffer.from('one').toString('base64') }],
    };
    const first = await app.inject({ method: 'POST', url: '/api/uploads?t=tok', payload });
    const second = await app.inject({ method: 'POST', url: '/api/uploads?t=tok', payload });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    const a = JSON.parse(first.body).files[0];
    const b = JSON.parse(second.body).files[0];
    assert.equal(a.name, 'same-.txt');
    assert.equal(b.name, 'same--2.txt');
    assert.equal(existsSync(a.path), true);
    assert.equal(existsSync(b.path), true);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/file opens or downloads project files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const upload = await app.inject({
      method: 'POST',
      url: '/api/uploads?t=tok',
      payload: {
        cwd: root,
        files: [{ name: 'report.xlsx', dataBase64: Buffer.from('xlsx bytes').toString('base64') }],
      },
    });
    const uploaded = JSON.parse(upload.body).files[0] as { relativePath: string };
    const open = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(uploaded.relativePath)}`,
    });
    assert.equal(open.statusCode, 200);
    assert.equal(open.body, 'xlsx bytes');
    assert.equal(open.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(String(open.headers['content-disposition']), /^inline; filename="report\.xlsx"/);

    const download = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(uploaded.relativePath)}&download=1`,
    });
    assert.equal(download.statusCode, 200);
    assert.match(String(download.headers['content-disposition']), /^attachment; filename="report\.xlsx"/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/file opens absolute files inside a project with spaces', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const project = join(root, 'random shit');
  mkdirSync(project);
  const file = join(project, 'hi.docx');
  writeFileSync(file, 'docx bytes');
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}&download=1`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'docx bytes');
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(String(res.headers['content-disposition']), /^attachment; filename="hi\.docx"/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/file opens absolute generated artifacts under server workspace even from another cwd', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const activeProject = join(root, 'chatgpt');
  const otherProject = join(root, 'random shit');
  mkdirSync(activeProject);
  mkdirSync(otherProject);
  const file = join(otherProject, 'hi.docx');
  writeFileSync(file, 'docx bytes');
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(file)}&download=1`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'docx bytes');
    assert.match(String(res.headers['content-disposition']), /^attachment; filename="hi\.docx"/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/file still rejects relative escapes even if sibling file is an artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const activeProject = join(root, 'chatgpt');
  const otherProject = join(root, 'random shit');
  mkdirSync(activeProject);
  mkdirSync(otherProject);
  writeFileSync(join(otherProject, 'hi.docx'), 'docx bytes');
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(activeProject)}&path=${encodeURIComponent('../random shit/hi.docx')}&download=1`,
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /outside the current project/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/file rejects absolute files outside workspace roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const outside = mkdtempSync(join(tmpdir(), 'ccw-outside-'));
  const activeProject = join(root, 'chatgpt');
  mkdirSync(activeProject);
  const file = join(outside, 'secret.txt');
  writeFileSync(file, 'secret');
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(file)}&download=1`,
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /outside the current project/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('GET /api/file rejects relative paths outside the project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccw-file-'));
  const app = Fastify({ logger: false });
  const sm = new SessionManager();
  registerApi(app, 'tok', root, sm);

  try {
    const res = await app.inject({
      method: 'GET',
      url: `/api/file?t=tok&cwd=${encodeURIComponent(root)}&path=${encodeURIComponent('../secret.txt')}`,
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /outside the current project/);
  } finally {
    await app.close();
    await sm.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});
