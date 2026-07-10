type ProjectRequestEntry<T> = {
  key: string;
  controller: AbortController;
  promise: Promise<T>;
  primaryGeneration: number;
};

/**
 * Coordinates project-session reads without coupling request lifecycle to
 * React renders. Duplicate reads share one promise; a newer primary project
 * aborts the previous primary read, and only the current request may commit.
 */
export class ProjectRequestCoordinator<T> {
  private readonly requests = new Map<string, ProjectRequestEntry<T>>();
  private primary?: ProjectRequestEntry<T>;
  private primaryGeneration = 0;
  private disposed = false;

  request(
    key: string,
    primary: boolean,
    load: (signal: AbortSignal) => Promise<T>,
    commit: (value: T, isCurrentPrimary: boolean) => void,
  ): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) {
      if (primary) this.promote(existing);
      return existing.promise;
    }

    const controller = new AbortController();
    const entry: ProjectRequestEntry<T> = {
      key,
      controller,
      promise: new Promise<T>(() => {}),
      primaryGeneration: 0,
    };
    if (primary) this.promote(entry);

    entry.promise = new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        let loaded: Promise<T>;
        try {
          loaded = load(controller.signal);
        } catch (error) {
          reject(error);
          return;
        }
        void loaded.then((value) => {
          if (!this.disposed && !controller.signal.aborted && this.requests.get(key) === entry) {
            const isCurrentPrimary = this.primary === entry
              && entry.primaryGeneration === this.primaryGeneration;
            commit(value, isCurrentPrimary);
          }
          resolve(value);
        }, reject);
      });
    }).finally(() => {
        if (this.requests.get(key) === entry) this.requests.delete(key);
        if (this.primary === entry) this.primary = undefined;
      });
    this.requests.set(key, entry);
    return entry.promise;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.requests.values()) entry.controller.abort();
    this.requests.clear();
    this.primary = undefined;
  }

  private promote(entry: ProjectRequestEntry<T>): void {
    if (this.primary && this.primary !== entry) this.primary.controller.abort();
    this.primaryGeneration += 1;
    entry.primaryGeneration = this.primaryGeneration;
    this.primary = entry;
  }
}
