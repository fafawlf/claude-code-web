export type ComposerScopeSnapshot<TAttachment> = {
  text: string;
  history: string[];
  historyCursor: number | null;
  historyDraft: string;
  attachments: TAttachment[];
};

export function composerScopeKey(cwd: string, sessionKey?: string | null): string {
  const project = cwd || '/';
  return sessionKey ? `${project}::session::${encodeURIComponent(sessionKey)}` : project;
}

export function composerDraftStorageKey(cwd: string, sessionKey?: string | null): string {
  return composerScopeKey(cwd, sessionKey);
}

export class ComposerScopeStore<TAttachment> {
  private readonly scopes = new Map<string, ComposerScopeSnapshot<TAttachment>>();

  read(key: string): ComposerScopeSnapshot<TAttachment> | undefined {
    const value = this.scopes.get(key);
    return value ? cloneSnapshot(value) : undefined;
  }

  save(key: string, value: ComposerScopeSnapshot<TAttachment>): void {
    this.scopes.set(key, cloneSnapshot(value));
  }

  updateAttachments(
    key: string,
    update: (attachments: TAttachment[]) => TAttachment[],
  ): void {
    const value = this.scopes.get(key);
    if (!value) return;
    this.scopes.set(key, { ...value, attachments: [...update([...value.attachments])] });
  }

  values(): ComposerScopeSnapshot<TAttachment>[] {
    return [...this.scopes.values()].map(cloneSnapshot);
  }
}

function cloneSnapshot<TAttachment>(
  value: ComposerScopeSnapshot<TAttachment>,
): ComposerScopeSnapshot<TAttachment> {
  return {
    ...value,
    history: [...value.history],
    attachments: [...value.attachments],
  };
}
