/** Replace only a complete home-directory path segment, never a lookalike. */
export function abbreviateHome(path: string, home = '/root'): string {
  const prefix = home.length > 1 ? home.replace(/\/+$/, '') : home;
  if (!prefix || (path !== prefix && !path.startsWith(`${prefix}/`))) return path;
  return `~${path.slice(prefix.length)}`;
}
