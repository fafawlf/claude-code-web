import { existsSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type ClaudeExecutableInfo = {
  source: 'env' | 'path' | 'bundled' | 'missing';
  label: string;
  path?: string;
  detail?: string;
};

// The SDK auto-picks a bundled native binary via optionalDependencies, but on
// some systems it picks the wrong libc variant (musl vs glibc). Resolve a
// working claude executable ourselves and pass it as pathToClaudeCodeExecutable.
export function detectClaudeExecutable(): ClaudeExecutableInfo {
  // 1. Explicit override.
  const envPath = process.env.CLAUDE_CODE_PATH;
  if (envPath && existsSync(envPath)) {
    return { source: 'env', label: 'CLAUDE_CODE_PATH', path: envPath, detail: envPath };
  }

  // 2. User's installed `claude` on PATH. Resolve symlinks so SDK gets the real binary.
  try {
    const which = execSync('command -v claude', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (which) {
      const resolved = (() => {
        try { return realpathSync(which); } catch { return which; }
      })();
      return { source: 'path', label: 'claude on PATH', path: resolved, detail: which };
    }
  } catch { /* fall through */ }

  // 3. SDK's bundled native binary — prefer glibc over musl on typical Linux.
  const candidates = [
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    '@anthropic-ai/claude-agent-sdk-linux-arm64',
    '@anthropic-ai/claude-agent-sdk-darwin-x64',
    '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  ];
  for (const pkg of candidates) {
    try {
      const pkgJson = require.resolve(`${pkg}/package.json`);
      const bin = pkgJson.replace(/package\.json$/, 'claude');
      if (existsSync(bin)) {
        return { source: 'bundled', label: 'Bundled Claude Code', path: bin, detail: pkg };
      }
    } catch { /* not installed */ }
  }

  return {
    source: 'missing',
    label: 'Claude executable not found',
    detail: envPath ? `CLAUDE_CODE_PATH does not exist: ${envPath}` : 'Install claude or set CLAUDE_CODE_PATH',
  };
}

export function resolveClaudePath(): string | undefined {
  return detectClaudeExecutable().path;
}
