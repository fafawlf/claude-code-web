export type DraftStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const DRAFT_PREFIX = 'ccw_prompt_draft:';

export function readPromptDraft(cwd: string, storage: DraftStorageLike = window.localStorage): string {
  return storage.getItem(keyFor(cwd)) ?? '';
}

export function writePromptDraft(cwd: string, value: string, storage: DraftStorageLike = window.localStorage): void {
  const text = value;
  if (text.trim()) storage.setItem(keyFor(cwd), text);
  else storage.removeItem(keyFor(cwd));
}

export function clearPromptDraft(cwd: string, storage: DraftStorageLike = window.localStorage): void {
  storage.removeItem(keyFor(cwd));
}

function keyFor(cwd: string): string {
  return `${DRAFT_PREFIX}${cwd || '/'}`;
}
