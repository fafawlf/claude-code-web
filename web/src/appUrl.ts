const rawBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';

export function appUrl(path: string): string {
  const base = normalizeBase(rawBase);
  const cleanPath = path.replace(/^\/+/, '');
  return `${base}${cleanPath}`;
}

export function assetUrl(path: string): string {
  return appUrl(path);
}

function normalizeBase(base: string): string {
  if (!base || base === './') return '/';
  return base.endsWith('/') ? base : `${base}/`;
}
