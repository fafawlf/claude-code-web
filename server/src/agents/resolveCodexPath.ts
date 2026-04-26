import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CodexExecutableInfo = {
  source: 'env' | 'path' | 'missing';
  label: string;
  path?: string;
  detail?: string;
  defaultModel?: string;
};

export function detectCodexExecutable(): CodexExecutableInfo {
  const defaultModel = readCodexDefaultModel();
  const envPath = process.env.CODEX_PATH;
  if (envPath && existsSync(envPath)) {
    return { source: 'env', label: 'CODEX_PATH', path: envPath, detail: envPath, defaultModel };
  }

  try {
    const which = execSync('command -v codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (which) {
      const resolved = realpathSync(which);
      return { source: 'path', label: 'codex on PATH', path: resolved, detail: which, defaultModel };
    }
  } catch {
    // Not installed on PATH.
  }

  return {
    source: 'missing',
    label: 'Codex executable not found',
    detail: envPath ? `CODEX_PATH does not exist: ${envPath}` : 'Install codex or set CODEX_PATH',
    defaultModel,
  };
}

export function resolveCodexPath(): string | undefined {
  const info = detectCodexExecutable();
  return info.source === 'missing' ? undefined : info.path;
}

export function readCodexDefaultModel(home = homedir()): string | undefined {
  try {
    const raw = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    const match = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}
