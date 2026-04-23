import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const CONFIG_DIR = join(homedir(), '.claudecode-web');
export const TOKEN_FILE = join(CONFIG_DIR, 'token');

export function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}
