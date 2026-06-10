import { appUrl } from './appUrl';

// Single place that knows how requests authenticate. In token mode the legacy
// `?t=` query param is appended; in feishu (cookie) mode there is no token and
// the session cookie rides along via credentials: 'include'.
let currentToken = '';

export function setApiToken(token: string | null | undefined): void {
  currentToken = token ?? '';
}

export function getApiToken(): string {
  return currentToken;
}

export function apiUrl(path: string): string {
  if (!currentToken) return appUrl(path);
  const sep = path.includes('?') ? '&' : '?';
  return appUrl(`${path}${sep}t=${encodeURIComponent(currentToken)}`);
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: 'include', ...init });
}
