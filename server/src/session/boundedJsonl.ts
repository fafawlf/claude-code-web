import { open } from 'node:fs/promises';
import {
  DEFAULT_REPLAY_MAX_BYTES,
  DEFAULT_REPLAY_MAX_EVENTS,
  DEFAULT_REPLAY_MAX_STRING_CHARS,
} from './ReplayBuffer.js';

const TRIMMED_SUFFIX = Buffer.from('... [trimmed]', 'utf8');
const UTF8_DECODER = new TextDecoder('utf-8');
const READ_BUFFER_BYTES = 64 * 1024;
const MAX_BOUNDED_LINE_BYTES = 512 * 1024;
// A source event still expands into provider-specific replay objects. Keeping
// the raw tail at half the final 32 MiB replay cap bounds the overlap while the
// tail is being decoded; live events can subsequently fill the full buffer.
const DEFAULT_HISTORY_SOURCE_MAX_BYTES = DEFAULT_REPLAY_MAX_BYTES / 2;

/**
 * Read a JSONL file into a fixed-size byte ring, then parse only the retained
 * replay tail. Large histories therefore allocate in proportion to the replay
 * limit, not the source file size.
 */
export async function* streamBoundedJsonLines<T>(
  file: string,
  options: {
    signal?: AbortSignal;
    maxStringBytes?: number;
    maxBytes?: number;
    maxEvents?: number;
    onTruncated?: (truncated: boolean) => void;
    pinLine?: (line: Buffer) => boolean;
  } = {},
): AsyncGenerator<T> {
  throwIfAborted(options.signal);
  const input = await open(file, 'r');
  const fileSize = (await input.stat()).size;
  const readBuffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  const tail = new ByteLineTail(
    Math.max(1, Math.min(fileSize, options.maxBytes ?? DEFAULT_HISTORY_SOURCE_MAX_BYTES)),
    options.maxEvents ?? DEFAULT_REPLAY_MAX_EVENTS,
    options.pinLine,
  );
  const maxStringBytes = options.maxStringBytes ?? DEFAULT_REPLAY_MAX_STRING_CHARS;
  const decoder = new BoundedJsonlDecoder(
    Math.max(1, maxStringBytes - TRIMMED_SUFFIX.length),
    (line) => tail.push(line),
    () => tail.markTruncated(),
  );
  let yieldedAt = performance.now();

  try {
    while (true) {
      throwIfAborted(options.signal);
      const { bytesRead } = await input.read(readBuffer, 0, readBuffer.length, null);
      if (bytesRead === 0) break;
      decoder.push(readBuffer.subarray(0, bytesRead));
      yieldedAt = await yieldIfNeeded(yieldedAt);
    }
    decoder.finish();
  } finally {
    await input.close();
  }

  options.onTruncated?.(tail.truncated);
  for (const line of tail.lines()) {
    throwIfAborted(options.signal);
    try {
      yield JSON.parse(UTF8_DECODER.decode(line)) as T;
    } catch {
      // Ignore diagnostics, corrupt records, and an incomplete append tail.
    }
    yieldedAt = await yieldIfNeeded(yieldedAt);
  }
}

class BoundedJsonlDecoder {
  private readonly line = Buffer.allocUnsafe(MAX_BOUNDED_LINE_BYTES);
  private lineLength = 0;
  private lineDropped = false;
  private inString = false;
  private lexEscaped = false;
  private stringKept = 0;
  private stringSafeLineLength = 0;
  private stringTruncated = false;
  private escapeRemaining = 0;
  private utf8Remaining = 0;

  constructor(
    private readonly maxStringBytes: number,
    private readonly onLine: (line: Buffer) => void,
    private readonly onDrop: () => void,
  ) {}

  push(chunk: Buffer): void {
    for (const byte of chunk) {
      if (byte === 10) {
        if (this.inString) this.lineDropped = true;
        this.emitLine();
        continue;
      }

      if (this.lineDropped) continue;
      if (!this.inString) {
        this.append(byte);
        if (byte === 34) this.startString();
        continue;
      }

      if (this.lexEscaped) {
        this.lexEscaped = false;
        this.keepStringByte(byte);
      } else if (byte === 92) {
        this.lexEscaped = true;
        this.keepStringByte(byte);
      } else if (byte === 34) {
        this.finishString();
      } else {
        this.keepStringByte(byte);
      }
    }
  }

  finish(): void {
    if (this.lineLength === 0 && !this.lineDropped) return;
    if (this.inString) this.lineDropped = true;
    this.emitLine();
  }

  private startString(): void {
    this.inString = true;
    this.lexEscaped = false;
    this.stringKept = 0;
    this.stringSafeLineLength = this.lineLength;
    this.stringTruncated = false;
    this.escapeRemaining = 0;
    this.utf8Remaining = 0;
  }

  private keepStringByte(byte: number): void {
    if (this.stringKept >= this.maxStringBytes) {
      this.stringTruncated = true;
      return;
    }
    this.append(byte);
    if (this.lineDropped) return;
    this.stringKept += 1;

    if (this.escapeRemaining === -1) {
      this.escapeRemaining = byte === 117 ? 4 : 0;
      if (this.escapeRemaining === 0) this.stringSafeLineLength = this.lineLength;
      return;
    }
    if (this.escapeRemaining > 0) {
      this.escapeRemaining -= 1;
      if (this.escapeRemaining === 0) this.stringSafeLineLength = this.lineLength;
      return;
    }
    if (this.utf8Remaining > 0) {
      this.utf8Remaining -= 1;
      if (this.utf8Remaining === 0) this.stringSafeLineLength = this.lineLength;
      return;
    }
    if (byte === 92) {
      this.escapeRemaining = -1;
      return;
    }
    if (byte >= 0xc2 && byte <= 0xdf) this.utf8Remaining = 1;
    else if (byte >= 0xe0 && byte <= 0xef) this.utf8Remaining = 2;
    else if (byte >= 0xf0 && byte <= 0xf4) this.utf8Remaining = 3;
    else this.stringSafeLineLength = this.lineLength;
  }

  private finishString(): void {
    if (this.stringTruncated) {
      this.lineLength = this.stringSafeLineLength;
      this.appendBuffer(TRIMMED_SUFFIX);
    }
    this.append(34);
    this.inString = false;
    this.lexEscaped = false;
  }

  private append(byte: number): void {
    if (this.lineLength >= this.line.length) {
      this.lineDropped = true;
      return;
    }
    this.line[this.lineLength] = byte;
    this.lineLength += 1;
  }

  private appendBuffer(value: Buffer): void {
    if (this.lineLength + value.length > this.line.length) {
      this.lineDropped = true;
      return;
    }
    value.copy(this.line, this.lineLength);
    this.lineLength += value.length;
  }

  private emitLine(): void {
    if (this.lineDropped) this.onDrop();
    else if (this.lineLength > 0) this.onLine(this.line.subarray(0, this.lineLength));
    this.lineLength = 0;
    this.lineDropped = false;
    this.inString = false;
    this.lexEscaped = false;
  }
}

class ByteLineTail {
  private readonly storage: Buffer;
  private readonly entries: Array<{ offset: number; length: number }> = [];
  private writeOffset = 0;
  private usedBytes = 0;
  private didTruncate = false;
  private readonly pinned: Buffer[] = [];
  private pinnedBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEvents: number,
    private readonly pinLine?: (line: Buffer) => boolean,
  ) {
    this.storage = Buffer.allocUnsafe(Math.max(1, maxBytes));
  }

  push(line: Buffer): void {
    if (this.pinLine?.(line) && this.pinned.length < 16 && this.pinnedBytes + line.length <= 1024 * 1024) {
      const copy = Buffer.from(line);
      this.pinned.push(copy);
      this.pinnedBytes += copy.length;
      return;
    }
    if (line.length > this.storage.length) {
      this.didTruncate = true;
      return;
    }
    if (this.writeOffset + line.length > this.storage.length) this.writeOffset = 0;

    while (
      this.entries.length > 0 &&
      (
        this.entries.length >= this.maxEvents ||
        this.usedBytes + line.length > this.storage.length ||
        overlaps(this.entries[0]!, this.writeOffset, line.length)
      )
    ) {
      const evicted = this.entries.shift()!;
      this.usedBytes -= evicted.length;
      this.didTruncate = true;
    }

    line.copy(this.storage, this.writeOffset);
    this.entries.push({ offset: this.writeOffset, length: line.length });
    this.writeOffset += line.length;
    this.usedBytes += line.length;
  }

  markTruncated(): void {
    this.didTruncate = true;
  }

  lines(): Buffer[] {
    return [
      ...this.pinned,
      ...this.entries.map(({ offset, length }) => this.storage.subarray(offset, offset + length)),
    ];
  }

  get truncated(): boolean {
    return this.didTruncate;
  }
}

function overlaps(entry: { offset: number; length: number }, offset: number, length: number): boolean {
  return offset < entry.offset + entry.length && entry.offset < offset + length;
}

async function yieldIfNeeded(lastYield: number): Promise<number> {
  if (performance.now() - lastYield < 8) return lastYield;
  await new Promise<void>((resolve) => setImmediate(resolve));
  return performance.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
