import { apiFetch } from './api';

export type ClientErrorPayload = {
  kind: 'error' | 'unhandledrejection';
  message: string;
  source?: string;
  line?: number;
  column?: number;
};

type SendError = (payload: ClientErrorPayload) => Promise<unknown> | unknown;

export function createClientErrorReporter(send: SendError, now = Date.now) {
  let windowStartedAt = 0;
  let sentInWindow = 0;
  const recent = new Map<string, number>();
  return (payload: ClientErrorPayload): void => {
    const timestamp = now();
    if (timestamp - windowStartedAt >= 60_000) {
      windowStartedAt = timestamp;
      sentInWindow = 0;
      recent.clear();
    }
    const clean = sanitizeClientError(payload);
    const fingerprint = `${clean.kind}:${clean.source ?? ''}:${clean.line ?? ''}:${clean.message}`;
    const recentAt = recent.get(fingerprint);
    if ((recentAt !== undefined && recentAt > timestamp - 10_000) || sentInWindow >= 10) return;
    recent.set(fingerprint, timestamp);
    sentInWindow += 1;
    try { void Promise.resolve(send(clean)).catch(() => undefined); } catch { /* reporting must never break the app */ }
  };
}

export function installClientErrorReporting(): () => void {
  const report = createClientErrorReporter((payload) => apiFetch('/api/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }));
  const onError = (event: ErrorEvent) => report({
    kind: 'error',
    message: event.message || 'Unknown browser error',
    source: safeSource(event.filename),
    line: event.lineno || undefined,
    column: event.colno || undefined,
  });
  const onRejection = (event: PromiseRejectionEvent) => report({
    kind: 'unhandledrejection',
    message: errorMessage(event.reason),
  });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

function sanitizeClientError(payload: ClientErrorPayload): ClientErrorPayload {
  return {
    kind: payload.kind,
    message: oneLine(payload.message).slice(0, 500) || 'Unknown browser error',
    source: payload.source ? oneLine(payload.source).split(/[?#]/, 1)[0]?.slice(0, 160) : undefined,
    line: safeCoordinate(payload.line),
    column: safeCoordinate(payload.column),
  };
}

function safeSource(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    return url.pathname.split('/').filter(Boolean).at(-1) ?? url.pathname;
  } catch {
    return value.split(/[?#]/, 1)[0]?.split('/').at(-1);
  }
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  return 'Unhandled promise rejection';
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function safeCoordinate(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && value! > 0 ? value : undefined;
}
