import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { TOKEN_FILE, ensureConfigDir } from './paths.js';

export function loadOrCreateToken(): string {
  ensureConfigDir();
  if (existsSync(TOKEN_FILE)) {
    const tok = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (tok.length >= 32) return tok;
  }
  const tok = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_FILE, tok + '\n', { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
  return tok;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
