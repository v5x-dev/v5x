import type { IPacketCallback } from "./Vex.js";

interface PendingPacketCallback extends IPacketCallback {
  active: boolean;
  next: PendingPacketCallback | undefined;
  previous: PendingPacketCallback | undefined;
  queue: PendingPacketQueue;
}

interface PendingPacketQueue {
  head: PendingPacketCallback | undefined;
  tail: PendingPacketCallback | undefined;
}

/** Routes replies to waiting requests and serializes identical commands. */
export class PendingRequestDispatcher {
  private pendingCallbacks = new Map<string, PendingPacketQueue>();
  private rawCallbacks: PendingPacketQueue = {
    head: undefined,
    tail: undefined,
  };
  private pendingCommandTails = new Map<string, Promise<void>>();

  get callbacks(): IPacketCallback[] {
    const callbacks: IPacketCallback[] = [];
    for (const queue of this.pendingCallbacks.values()) {
      for (let callback = queue.head; callback; callback = callback.next) {
        callbacks.push(callback);
      }
    }
    for (
      let callback = this.rawCallbacks.head;
      callback;
      callback = callback.next
    ) {
      callbacks.push(callback);
    }
    return callbacks;
  }

  get hasPending(): boolean {
    return (
      this.pendingCallbacks.size > 0 || this.rawCallbacks.head !== undefined
    );
  }

  async serialize<T>(
    commandId: number,
    commandExtendedId: number | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(commandId, commandExtendedId);
    const previous = this.pendingCommandTails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pendingCommandTails.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.pendingCommandTails.get(key) === current) {
        this.pendingCommandTails.delete(key);
      }
    }
  }

  add(callback: IPacketCallback): () => boolean {
    const queue =
      callback.wantedCommandId === undefined
        ? this.rawCallbacks
        : this.getQueue(
            callback.wantedCommandId,
            callback.wantedCommandExId,
            true,
          );
    const pending: PendingPacketCallback = {
      ...callback,
      active: true,
      next: undefined,
      previous: queue.tail,
      queue,
    };
    if (queue.tail === undefined) queue.head = pending;
    else queue.tail.next = pending;
    queue.tail = pending;
    return () => this.remove(pending);
  }

  shift(
    commandId: number,
    commandExtendedId: number | undefined,
  ): IPacketCallback | undefined {
    const typed = this.getQueue(commandId, commandExtendedId, false).head;
    const callback = typed ?? this.rawCallbacks.head;
    if (callback !== undefined) this.remove(callback);
    return callback;
  }

  drain(): IPacketCallback[] {
    const callbacks = this.callbacks;
    for (const callback of callbacks) clearTimeout(callback.timeout);
    this.pendingCallbacks.clear();
    this.rawCallbacks = { head: undefined, tail: undefined };
    return callbacks;
  }

  private key(
    commandId: number,
    commandExtendedId: number | undefined,
  ): string {
    return `${commandId}:${commandExtendedId ?? ""}`;
  }

  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: boolean,
  ): PendingPacketQueue {
    const key = this.key(commandId, commandExtendedId);
    let queue = this.pendingCallbacks.get(key);
    if (queue === undefined && create) {
      queue = { head: undefined, tail: undefined };
      this.pendingCallbacks.set(key, queue);
    }
    return queue ?? { head: undefined, tail: undefined };
  }

  private remove(callback: PendingPacketCallback): boolean {
    if (!callback.active) return false;
    callback.active = false;
    const { queue, previous, next } = callback;
    if (previous === undefined) queue.head = next;
    else previous.next = next;
    if (next === undefined) queue.tail = previous;
    else next.previous = previous;
    callback.previous = undefined;
    callback.next = undefined;
    if (
      queue !== this.rawCallbacks &&
      queue.head === undefined &&
      callback.wantedCommandId !== undefined
    ) {
      this.pendingCallbacks.delete(
        this.key(callback.wantedCommandId, callback.wantedCommandExId),
      );
    }
    return true;
  }
}
