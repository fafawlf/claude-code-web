import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UploadPool, planUploadSelection, uploadFileMultipart, uploadStartBlockReason } from '../uploads';

test('[QA] uploads stay blocked until the target attachment is ready and writable', () => {
  assert.equal(uploadStartBlockReason(false, false), 'Still connecting. Try again in a moment.');
  assert.equal(uploadStartBlockReason(true, true), 'Press Continue writing to take over this chat.');
  assert.equal(uploadStartBlockReason(true, false), null);
});

// QA regression: the browser must stop a thirteenth attachment before any network work starts.
test('[QA] upload selection accepts at most 12 attachments', () => {
  const files = [fakeFile('twelve.txt', 1), fakeFile('thirteen.txt', 1)];
  const result = planUploadSelection({ fileCount: 11, totalBytes: 11 }, files);

  assert.deepEqual(result.accepted.map((entry) => entry.file.name), ['twelve.txt']);
  assert.deepEqual(result.rejected.map((entry) => entry.file.name), ['thirteen.txt']);
  assert.match(result.rejected[0].error, /at most 12 files/);
});

// QA regression: oversized files are rejected locally instead of allocating upload work.
test('[QA] upload selection enforces the 25 MiB per-file cap', () => {
  const result = planUploadSelection(
    { fileCount: 0, totalBytes: 0 },
    [fakeFile('large.bin', 25 * 1024 * 1024 + 1, 'application/octet-stream')],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].error, /larger than 25 MB/);
});

// QA regression: individually-valid files cannot exceed the browser's explicit batch cap.
test('[QA] upload selection enforces the 50 MiB total cap', () => {
  const result = planUploadSelection(
    { fileCount: 2, totalBytes: 50 * 1024 * 1024 },
    [fakeFile('extra.txt', 1)],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].error, /50 MB total limit/);
});

// QA regression: selecting a large batch must not start more than two browser uploads.
test('[QA] upload pool limits active uploads to two', async () => {
  const pool = new UploadPool(2);
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const run = (name: string) => pool.enqueue('scope', async () => {
    started.push(name);
    await new Promise<void>((resolve) => releases.set(name, resolve));
    return name;
  });

  const first = run('a');
  const second = run('b');
  const third = run('c');
  await nextTurn();
  assert.deepEqual(started, ['a', 'b']);

  releases.get('a')?.();
  assert.equal(await first.promise, 'a');
  await nextTurn();
  assert.deepEqual(started, ['a', 'b', 'c']);

  releases.get('b')?.();
  releases.get('c')?.();
  await Promise.all([second.promise, third.promise]);
});

// QA regression: switching composer scope aborts active work and discards queued old-scope files.
test('[QA] upload pool cancels active and queued uploads for the old scope', async () => {
  const pool = new UploadPool(1);
  const started: string[] = [];
  const run = (name: string) => pool.enqueue('old', (signal) => new Promise<string>((resolve, reject) => {
    started.push(name);
    signal.addEventListener('abort', () => {
      const error = new Error('canceled');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
    void resolve;
  }));
  const active = run('active');
  const queued = run('queued');
  await nextTurn();
  assert.deepEqual(started, ['active']);

  pool.cancelScope('old');
  await assert.rejects(active.promise, { name: 'AbortError' });
  await assert.rejects(queued.promise, { name: 'AbortError' });
  assert.deepEqual(started, ['active']);
});

// QA regression: modern browsers send the File through FormData and expose native progress.
test('[QA] upload transport uses token-authenticated multipart without Base64 encoding', async () => {
  const xhr = new FakeXhr();
  const progress: number[] = [];
  const file = new File([Buffer.from([0, 1, 2, 255])], 'raw.bin', { type: 'application/octet-stream' });

  const uploaded = await uploadFileMultipart(file, '/project with spaces', {
      token: 'secret token',
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
      onProgress: (value) => progress.push(value),
    });

    assert.equal(xhr.method, 'POST');
    assert.match(xhr.url, /\/api\/uploads\?t=secret%20token&cwd=%2Fproject%20with%20spaces$/);
    assert.equal(xhr.withCredentials, true);
    assert.ok(xhr.body instanceof FormData);
    const sentFile = (xhr.body as FormData).get('files');
    assert.ok(sentFile instanceof File);
    assert.equal(sentFile.name, file.name);
    assert.equal(sentFile.size, file.size);
    assert.deepEqual(progress, [50]);
    assert.equal(uploaded.name, 'raw.bin');
});

// QA regression: removing an attachment or switching scope must abort the native request.
test('[QA] upload transport aborts the request through AbortSignal', async () => {
  const xhr = new FakeXhr();
  xhr.autoLoad = false;
  const controller = new AbortController();
  const pending = uploadFileMultipart(new File(['x'], 'x.txt'), '/project', {
    signal: controller.signal,
    xhrFactory: () => xhr as unknown as XMLHttpRequest,
  });

  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(xhr.aborted, true);
});

function fakeFile(name: string, size: number, type = 'text/plain'): File {
  return { name, size, type } as File;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeXhr {
  method = '';
  url = '';
  withCredentials = false;
  status = 200;
  statusText = 'OK';
  responseText = JSON.stringify({
    files: [{
      name: 'raw.bin',
      path: '/project with spaces/.claudecode-web/uploads/2026-07-10/raw.bin',
      relativePath: '.claudecode-web/uploads/2026-07-10/raw.bin',
      mime: 'application/octet-stream',
      size: 4,
    }],
  });
  body: Document | XMLHttpRequestBodyInit | null = null;
  autoLoad = true;
  aborted = false;
  upload = { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent<EventTarget>);
    if (this.autoLoad) queueMicrotask(() => this.onload?.());
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}
