/**
 * Runs operations one at a time in call order. Each call captures the current
 * tail and chains after it, so operations never interleave regardless of how
 * many callers race to enqueue.
 */
export class TailQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** True while any operation is queued or running. */
  get isActive(): boolean {
    return this.depth > 0;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => current);
    this.depth++;
    try {
      await previous;
      return await operation();
    } finally {
      this.depth--;
      release();
    }
  }
}
