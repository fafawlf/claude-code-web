export const DEFAULT_REPLAY_MAX_EVENTS = 5_000;
export const DEFAULT_REPLAY_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_REPLAY_MAX_STRING_CHARS = 32 * 1024;

export type ReplayBufferOptions<T> = {
  maxEvents?: number;
  maxBytes?: number;
  sizeOf?: (value: T) => number;
};

/**
 * Replay storage bounded by both event count and approximate serialized bytes.
 * `truncated` is sticky: once an old event has been evicted, callers know a
 * full replay is no longer available from this process.
 */
export class ReplayBuffer<T> {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (value: T) => number;
  private values: T[] = [];
  private sizes: number[] = [];
  private storedBytes = 0;
  private didTruncate = false;

  constructor(options: ReplayBufferOptions<T> = {}) {
    this.maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_REPLAY_MAX_EVENTS);
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_REPLAY_MAX_BYTES);
    this.sizeOf = options.sizeOf ?? estimateReplayBytes;
  }

  push(value: T): void {
    const bytes = Math.max(0, this.sizeOf(value));
    this.values.push(value);
    this.sizes.push(bytes);
    this.storedBytes += bytes;

    while (this.values.length > this.maxEvents || this.storedBytes > this.maxBytes) {
      this.values.shift();
      this.storedBytes -= this.sizes.shift() ?? 0;
      this.didTruncate = true;
    }
  }

  filter(predicate: (value: T) => boolean): T[] {
    return this.values.filter(predicate);
  }

  toArray(): T[] {
    return [...this.values];
  }

  get length(): number {
    return this.values.length;
  }

  get byteLength(): number {
    return this.storedBytes;
  }

  get truncated(): boolean {
    return this.didTruncate;
  }
}

/**
 * Clone a replay event while bounding every retained string. This prevents a
 * single command output or embedded image from dominating the heap before the
 * byte-bounded replay buffer can evict it.
 */
export function boundReplayValue<T>(value: T, maxStringChars = DEFAULT_REPLAY_MAX_STRING_CHARS): T {
  const seen = new WeakMap<object, unknown>();

  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return capReplayString(current, maxStringChars);
    if (!current || typeof current !== 'object') return current;
    const cached = seen.get(current);
    if (cached !== undefined) return cached;

    if (Array.isArray(current)) {
      const out: unknown[] = [];
      seen.set(current, out);
      for (const item of current) out.push(visit(item));
      return out;
    }

    const source = current as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    seen.set(current, out);
    for (const [key, child] of Object.entries(source)) {
      if (key === 'data' && source.type === 'base64' && typeof child === 'string') {
        out[key] = '[binary omitted]';
      } else {
        out[key] = visit(child);
      }
    }
    return out;
  };

  return visit(value) as T;
}

export function estimateReplayBytes(value: unknown): number {
  let bytes = 0;
  const seen = new WeakSet<object>();

  const visit = (current: unknown): void => {
    if (current === null || current === undefined) {
      bytes += 4;
      return;
    }
    if (typeof current === 'string') {
      bytes += Buffer.byteLength(current, 'utf8') + 2;
      return;
    }
    if (typeof current === 'number' || typeof current === 'boolean') {
      bytes += 8;
      return;
    }
    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      bytes += 2;
      for (const child of current) visit(child);
      return;
    }
    bytes += 2;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      bytes += Buffer.byteLength(key, 'utf8') + 3;
      visit(child);
    }
  };

  visit(value);
  return bytes;
}

function capReplayString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n… [trimmed ${value.length - maxChars} chars]`;
}
