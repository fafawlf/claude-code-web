import { existsSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';

export type CodexExecutableInfo = {
  source: 'env' | 'path' | 'missing';
  label: string;
  path?: string;
  detail?: string;
};

export function detectCodexExecutable(): CodexExecutableInfo {
  const envPath = process.env.CODEX_PATH;
  if (envPath && existsSync(envPath)) {
    return { source: 'env', label: 'CODEX_PATH', path: envPath, detail: envPath };
  }

  try {
    const which = execSync('command -v codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (which) {
      const resolved = realpathSync(which);
      return { source: 'path', label: 'codex on PATH', path: resolved, detail: which };
    }
  } catch {
    // Not installed on PATH.
  }

  return {
    source: 'missing',
    label: 'Codex executable not found',
    detail: envPath ? `CODEX_PATH does not exist: ${envPath}` : 'Install codex or set CODEX_PATH',
  };
}
