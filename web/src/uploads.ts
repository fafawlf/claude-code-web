import { appUrl } from './appUrl';

export type UploadedFileRef = {
  name: string;
  path: string;
  relativePath: string;
  mime?: string;
  size: number;
};

export const MAX_UPLOAD_FILES = 12;
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 50 * 1024 * 1024;

export function uploadStartBlockReason(ready: boolean, readOnly: boolean): string | null {
  if (readOnly) return 'Press Continue writing to take over this chat.';
  if (!ready) return 'Still connecting. Try again in a moment.';
  return null;
}

type UploadSelectionFile = Pick<File, 'name' | 'size' | 'type'>;

export type UploadSelectionResult<T extends UploadSelectionFile> = {
  accepted: Array<{ file: T }>;
  rejected: Array<{ file: T; error: string }>;
};

export function planUploadSelection<T extends UploadSelectionFile>(
  existing: { fileCount: number; totalBytes: number },
  files: readonly T[],
): UploadSelectionResult<T> {
  const accepted: Array<{ file: T }> = [];
  const rejected: Array<{ file: T; error: string }> = [];
  let fileCount = existing.fileCount;
  let totalBytes = existing.totalBytes;

  for (const file of files) {
    if (fileCount >= MAX_UPLOAD_FILES) {
      rejected.push({ file, error: `Upload at most ${MAX_UPLOAD_FILES} files` });
      continue;
    }
    fileCount += 1;
    if (file.size <= 0) {
      rejected.push({ file, error: 'File is empty' });
      continue;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      rejected.push({ file, error: 'File is larger than 25 MB' });
      continue;
    }
    if (totalBytes + file.size > MAX_UPLOAD_TOTAL_BYTES) {
      rejected.push({ file, error: 'Attachments are larger than the 50 MB total limit' });
      continue;
    }
    totalBytes += file.size;
    accepted.push({ file });
  }
  return { accepted, rejected };
}

export type UploadHandle<T> = {
  promise: Promise<T>;
  cancel: () => void;
};

type UploadQueueEntry<T> = {
  scopeKey: string;
  run: (signal: AbortSignal) => Promise<T>;
  controller: AbortController;
  started: boolean;
  settled: boolean;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export class UploadPool {
  private readonly pending: Array<UploadQueueEntry<unknown>> = [];
  private readonly entries = new Set<UploadQueueEntry<unknown>>();
  private active = 0;

  constructor(private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Upload concurrency must be at least one');
  }

  enqueue<T>(scopeKey: string, run: (signal: AbortSignal) => Promise<T>): UploadHandle<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    const entry: UploadQueueEntry<T> = {
      scopeKey,
      run,
      controller: new AbortController(),
      started: false,
      settled: false,
      resolve,
      reject,
    };
    this.pending.push(entry as UploadQueueEntry<unknown>);
    this.entries.add(entry as UploadQueueEntry<unknown>);
    this.pump();
    return { promise, cancel: () => this.cancelEntry(entry as UploadQueueEntry<unknown>) };
  }

  cancelScope(scopeKey: string): void {
    for (const entry of [...this.entries]) {
      if (entry.scopeKey === scopeKey) this.cancelEntry(entry);
    }
  }

  cancelAll(): void {
    for (const entry of [...this.entries]) this.cancelEntry(entry);
  }

  private cancelEntry(entry: UploadQueueEntry<unknown>): void {
    if (entry.settled) return;
    if (entry.started) {
      entry.controller.abort();
      return;
    }
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
    entry.settled = true;
    this.entries.delete(entry);
    entry.reject(uploadAbortError());
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      if (entry.settled) continue;
      entry.started = true;
      this.active += 1;
      Promise.resolve()
        .then(() => entry.run(entry.controller.signal))
        .then(
          (value) => {
            if (!entry.settled) {
              entry.settled = true;
              entry.resolve(value);
            }
          },
          (error) => {
            if (!entry.settled) {
              entry.settled = true;
              entry.reject(error);
            }
          },
        )
        .finally(() => {
          this.entries.delete(entry);
          this.active -= 1;
          this.pump();
        });
    }
  }
}

function uploadAbortError(): Error {
  const error = new Error('Upload canceled');
  error.name = 'AbortError';
  return error;
}

export type MultipartUploadOptions = {
  token?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  xhrFactory?: () => XMLHttpRequest;
};

export function uploadFileMultipart(
  file: File,
  cwd: string,
  options: MultipartUploadOptions = {},
): Promise<UploadedFileRef> {
  return new Promise((resolve, reject) => {
    const xhr = options.xhrFactory?.() ?? new XMLHttpRequest();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => xhr.abort();

    const auth = options.token ? `t=${encodeURIComponent(options.token)}&` : '';
    xhr.open('POST', appUrl(`/api/uploads?${auth}cwd=${encodeURIComponent(cwd)}`));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.(Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(new Error(parseUploadError(xhr.responseText, xhr.statusText))));
        return;
      }
      try {
        const response = JSON.parse(xhr.responseText) as { files?: UploadedFileRef[] };
        const uploaded = response.files?.[0];
        if (!uploaded) throw new Error('Upload missing from response');
        finish(() => resolve(uploaded));
      } catch (e) {
        finish(() => reject(e));
      }
    };
    xhr.onerror = () => finish(() => reject(new Error('Upload failed. Check your connection and retry.')));
    xhr.onabort = () => finish(() => reject(uploadAbortError()));

    if (options.signal?.aborted) {
      finish(() => reject(uploadAbortError()));
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('files', file, file.name || 'upload');
    xhr.send(form);
  });
}

function parseUploadError(responseText: string, statusText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: string };
    return parsed.error || statusText || 'Upload failed';
  } catch {
    return statusText || 'Upload failed';
  }
}

export function buildAttachmentPrompt(text: string, files: UploadedFileRef[]): string {
  const body = text.trim();
  if (files.length === 0) return body;
  const lines = [
    'Uploaded files:',
    ...files.map((f) => `- @${f.relativePath} (${fileKind(f)}, ${formatFileSize(f.size)})`),
  ];
  if (!body) return `Please inspect these uploaded files:\n\n${lines.join('\n')}`;
  return `${body}\n\n${lines.join('\n')}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fileKind(file: UploadedFileRef): string {
  if (file.mime?.startsWith('image/')) return file.mime.replace('image/', '');
  return file.mime || 'file';
}
