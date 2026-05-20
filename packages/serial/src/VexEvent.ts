export class VexEventEmitter {
  handlerMap: Map<string | symbol, Array<(...args: unknown[]) => void>>;

  constructor() {
    this.handlerMap = new Map<string, Array<(...args: unknown[]) => void>>();
  }

  on(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
    let listeners = this.handlerMap.get(eventName);
    listeners ??= [];

    listeners.push(listener);

    this.handlerMap.set(eventName, listeners);
  }

  remove(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): void {
    let listeners = this.handlerMap.get(eventName);
    listeners ??= [];

    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }

    this.handlerMap.set(eventName, listeners);
  }

  emit(eventName: string | symbol, data: unknown): void {
    (this.handlerMap.get(eventName) ?? []).forEach((callback) => {
      callback(data);
    });
  }

  clearListeners(): void {
    this.handlerMap.clear();
  }
}

export class VexEventTarget {
  emitter: VexEventEmitter;

  constructor() {
    this.emitter = new VexEventEmitter();
  }

  emit(eventName: string | symbol, data: unknown): void {
    this.emitter.emit(String(eventName), data);
  }

  on(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
    this.emitter.on(String(eventName), listener);
  }

  remove(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): void {
    this.emitter.remove(String(eventName), listener);
  }

  clearListeners(): void {
    this.emitter.clearListeners();
  }
}
