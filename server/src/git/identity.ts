// Per-session git identity. All sessions run as the same OS user (root) and
// share /root's credentials, so without this every teammate's commits would be
// authored as the server owner. We inject GIT_AUTHOR_*/GIT_COMMITTER_* into the
// agent subprocess env so each commit is attributed to the logged-in user.
// This does NOT change push credentials (gh token / ssh key stay shared) — it
// only fixes commit authorship.

export type GitIdentity = { name: string; email: string };

export function envWithGitIdentity(base: NodeJS.ProcessEnv, id?: GitIdentity): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (typeof v === 'string') out[k] = v;
  if (id) {
    out.GIT_AUTHOR_NAME = id.name;
    out.GIT_AUTHOR_EMAIL = id.email;
    out.GIT_COMMITTER_NAME = id.name;
    out.GIT_COMMITTER_EMAIL = id.email;
  }
  return out;
}
