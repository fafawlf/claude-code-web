import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';

/**
 * Create a user's workspace on first login. Copies the template directory
 * when one exists, otherwise drops a minimal starter CLAUDE.md. Idempotent:
 * an existing non-empty workspace is left untouched.
 */
export async function provisionWorkspace(workspaceRoot: string, templateDir?: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  const entries = await readdir(workspaceRoot).catch(() => []);
  if (entries.length > 0) return;

  if (templateDir) {
    try {
      await cp(templateDir, workspaceRoot, { recursive: true });
      return;
    } catch {
      // No template — fall through to the starter file.
    }
  }
  const starter = [
    '# My workspace',
    '',
    'This folder is your personal Claude Code workspace. Create one folder per',
    'project. Skills you put in `<project>/.claude/skills/` are yours alone;',
    'shared team context lives in the parent directories.',
    '',
  ].join('\n');
  await writeFile(`${workspaceRoot}/CLAUDE.md`, starter, { flag: 'wx' }).catch(() => undefined);
}
