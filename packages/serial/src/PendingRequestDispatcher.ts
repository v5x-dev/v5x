import type { IPacketCallback } from "./Vex.js";
import { TailQueue } from "./TailQueue.js";

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
  private pendingCommandTails = new Map<string, TailQueue>();

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
    let queue = this.pendingCommandTails.get(key);
    if (queue === undefined) {
      queue = new TailQueue();
      this.pendingCommandTails.set(key, queue);
    }

    try {
      return await queue.run(operation);
    } finally {
      // Later callers enqueue synchronously, so an inactive queue here has no
      // successor waiting and can be dropped rather than retained per command.
      if (!queue.isActive && this.pendingCommandTails.get(key) === queue) {
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
    const typed = this.getQueue(commandId, commandExtendedId, false)?.head;
    const callback = typed ?? this.rawCallbacks.head;
    if (callback !== undefined) this.remove(callback);
    return callback;
  }

  drain(): IPacketCallback[] {
    const callbacks: IPacketCallback[] = [];
    for (const queue of this.pendingCallbacks.values()) {
      this.drainQueue(queue, callbacks);
    }
    this.drainQueue(this.rawCallbacks, callbacks);
    this.pendingCallbacks.clear();
    this.rawCallbacks = { head: undefined, tail: undefined };
    return callbacks;
  }

  private drainQueue(
    queue: PendingPacketQueue,
    callbacks: IPacketCallback[],
  ): void {
    let callback = queue.head;
    while (callback !== undefined) {
      const next = callback.next;
      clearTimeout(callback.timeout);
      callback.active = false;
      callback.previous = undefined;
      callback.next = undefined;
      callbacks.push(callback);
      callback = next;
    }
    queue.head = undefined;
    queue.tail = undefined;
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
    create: true,
  ): PendingPacketQueue;
  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: false,
  ): PendingPacketQueue | undefined;
  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: boolean,
  ): PendingPacketQueue | undefined {
    const key = this.key(commandId, commandExtendedId);
    let queue = this.pendingCallbacks.get(key);
    if (queue === undefined && create) {
      queue = { head: undefined, tail: undefined };
      this.pendingCallbacks.set(key, queue);
    }
    return queue;
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
