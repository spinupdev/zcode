/**
 * Single-writer lock shared between FileSystemProvider and git worker (KD5).
 */

export class WorkspaceLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  async withLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(() => gate);
    this.chains.set(
      workspaceId,
      next.catch(() => {
        /* keep chain alive */
      }),
    );
    await prev.catch(() => {
      /* previous failure should not block */
    });
    try {
      return await fn();
    } finally {
      release();
      // prune if we are still the tail
      if (this.chains.get(workspaceId) === next) {
        // leave resolved promise; optional cleanup
      }
    }
  }

  /** Test helper: whether a chain entry exists */
  has(workspaceId: string): boolean {
    return this.chains.has(workspaceId);
  }
}
