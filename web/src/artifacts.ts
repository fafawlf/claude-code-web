export type ArtifactMatch = {
  raw: string;
  path: string;
  start: number;
  end: number;
};

const PATH_PATTERNS = [
  // Absolute paths often include project names with spaces, e.g.
  // /root/random shit/hi.docx.
  /@?(?:~|\/)(?:[A-Za-z0-9_.+@() -]+\/)+[A-Za-z0-9_.+@() -]+\.[A-Za-z0-9]{1,12}/g,
  /@?\.{1,2}\/(?:[A-Za-z0-9_.+@() -]+\/)*[A-Za-z0-9_.+@() -]+\.[A-Za-z0-9]{1,12}/g,
  // Plain relative paths stay stricter so prose before "output/report.pdf"
  // does not become part of the detected filename.
  /@?(?:[A-Za-z0-9_.+@()-]+\/)+[A-Za-z0-9_.+@()-]+\.[A-Za-z0-9]{1,12}/g,
];

const ARTIFACT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'gif', 'html', 'jpeg', 'jpg', 'json', 'log', 'md', 'pdf',
  'png', 'ppt', 'pptx', 'svg', 'txt', 'webp', 'xls', 'xlsx', 'zip',
]);

export function findArtifactPaths(text: string): ArtifactMatch[] {
  const out: ArtifactMatch[] = [];
  for (const pattern of PATH_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const start = match.index ?? 0;
      if (looksLikeUrlContext(text, start)) continue;
      const trimmed = trimTrailing(raw);
      if (looksLikeEmbeddedAbsolutePath(text, start, trimmed)) continue;
      const path = trimmed.replace(/^@/, '');
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      if (!ARTIFACT_EXTENSIONS.has(ext)) continue;
      const candidate = { raw: trimmed, path, start, end: start + trimmed.length };
      if (out.some((existing) => rangesOverlap(existing, candidate))) continue;
      out.push(candidate);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function isArtifactPath(value: string): boolean {
  const trimmed = value.trim();
  const matches = findArtifactPaths(trimmed);
  return matches.length === 1 && matches[0].raw === trimmed;
}

export function artifactUrl(opts: { token: string; cwd: string; path: string; download?: boolean }): string {
  const params = new URLSearchParams({
    t: opts.token,
    cwd: opts.cwd,
    path: opts.path.replace(/^@/, ''),
  });
  if (opts.download) params.set('download', '1');
  return `/api/file?${params.toString()}`;
}

export function compactArtifactPath(path: string): string {
  if (path.length <= 52) return path;
  const parts = path.split('/');
  if (parts.length >= 4) return `${parts[0] || '/'}.../${parts.slice(-3).join('/')}`;
  return `${path.slice(0, 22)}...${path.slice(-24)}`;
}

function trimTrailing(value: string): string {
  return value.replace(/[),.;:!?，。；：！？]+$/g, '');
}

function looksLikeUrlContext(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 160), start).toLowerCase();
  const after = text.slice(start, start + 8).toLowerCase();
  const lastBreak = Math.max(
    before.lastIndexOf(' '),
    before.lastIndexOf('\n'),
    before.lastIndexOf('\t'),
    before.lastIndexOf('('),
    before.lastIndexOf('['),
    before.lastIndexOf('<'),
  );
  const fragment = before.slice(lastBreak + 1);
  return fragment.includes('http:/') || fragment.includes('https:/') || after.startsWith('http://') || after.startsWith('https://');
}

function rangesOverlap(a: Pick<ArtifactMatch, 'start' | 'end'>, b: Pick<ArtifactMatch, 'start' | 'end'>): boolean {
  return a.start < b.end && b.start < a.end;
}

function looksLikeEmbeddedAbsolutePath(text: string, start: number, raw: string): boolean {
  if (!raw.replace(/^@/, '').startsWith('/')) return false;
  const prev = text[start - 1];
  return !!prev && /[A-Za-z0-9_.+@):/-]/.test(prev);
}
