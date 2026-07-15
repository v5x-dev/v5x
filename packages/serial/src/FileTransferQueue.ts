/** Serializes operations that enter the device's file-transfer mode. */
export class FileTransferQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

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
