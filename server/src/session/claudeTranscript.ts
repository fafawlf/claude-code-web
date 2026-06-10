import { getSessionMessages, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { access, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ClaudeTranscriptMessage = SDKMessage | Record<string, unknown>;

export async function loadClaudeTranscriptMessages(sessionId: string, cwd: string, searchRoot?: string): Promise<ClaudeTranscriptMessage[]> {
  const fast = await loadClaudeTranscriptFast(sessionId, cwd, homedir(), searchRoot);
  if (fast) return fast;
  return getSessionMessages(sessionId, { dir: cwd }) as unknown as ClaudeTranscriptMessage[];
}

export async function loadClaudeTranscriptFast(sessionId: string, cwd: string, home = homedir(), searchRoot?: string): Promise<ClaudeTranscriptMessage[] | undefined> {
  const file = await findClaudeTranscriptFile(sessionId, cwd, home, searchRoot);
  if (!file) return undefined;
  const raw = await readFile(file, 'utf8');
  const messages: ClaudeTranscriptMessage[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!isTranscriptMessage(parsed)) continue;
      messages.push({
        ...parsed,
        parent_tool_use_id: (parsed as { parent_tool_use_id?: unknown }).parent_tool_use_id ?? null,
      } as unknown as SDKMessage);
    } catch {
      // Ignore corrupt partial lines; Claude can be appending to this file.
    }
  }
  return messages;
}

export async function findClaudeTranscriptFile(sessionId: string, cwd: string, home: string, searchRoot?: string): Promise<string | undefined> {
  const projects = join(home, '.claude', 'projects');
  const direct = join(projects, encodeClaudeProjectPath(cwd), `${sessionId}.jsonl`);
  // When a searchRoot is given (multi-user mode), only transcripts whose
  // recorded cwd lives under that root may be opened — even by exact UUID.
  const allowedPrefix = searchRoot ? encodeClaudeProjectPath(searchRoot) : undefined;
  try {
    if (!allowedPrefix || isEncodedPathInside(encodeClaudeProjectPath(cwd), allowedPrefix)) {
      await access(direct);
      return direct;
    }
  } catch {
    // Fall through to a one-level search. This keeps old sessions openable even
    // when the stored cwd differs slightly from the currently selected project.
  }

  try {
    const dirs = await readdir(projects, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (allowedPrefix && !isEncodedPathInside(dir.name, allowedPrefix)) continue;
      const candidate = join(projects, dir.name, `${sessionId}.jsonl`);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Keep scanning.
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isEncodedPathInside(encoded: string, encodedRoot: string): boolean {
  return encoded === encodedRoot || encoded.startsWith(`${encodedRoot}-`);
}

export function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function isTranscriptMessage(value: Record<string, unknown>): boolean {
  if ((value.type === 'user' || value.type === 'assistant') && typeof value.message === 'object' && value.message !== null) {
    return true;
  }
  if (value.type === 'attachment' && typeof value.attachment === 'object' && value.attachment !== null) {
    const attachment = value.attachment as Record<string, unknown>;
    return attachment.type === 'plan_mode' && typeof attachment.planFilePath === 'string';
  }
  return false;
}
