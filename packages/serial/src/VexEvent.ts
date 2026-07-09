type EventName = string | symbol;
type EventMapKey<TEvents> = Extract<keyof TEvents, EventName>;
type EventListener<TValue> = (data: TValue) => void;

export class VexEventEmitter<
  TEvents extends object = Record<EventName, unknown>,
> {
  handlerMap: Map<EventName, Array<EventListener<unknown>>>;

  constructor() {
    this.handlerMap = new Map<EventName, Array<EventListener<unknown>>>();
  }

  on<K extends EventMapKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    let listeners = this.handlerMap.get(eventName);
    listeners ??= [];

    listeners.push(listener as EventListener<unknown>);

    this.handlerMap.set(eventName, listeners);
  }

  remove<K extends EventMapKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    let listeners = this.handlerMap.get(eventName);
    listeners ??= [];

    const index = listeners.indexOf(listener as EventListener<unknown>);
    if (index > -1) {
      listeners.splice(index, 1);
    }

    this.handlerMap.set(eventName, listeners);
  }

  emit<K extends EventMapKey<TEvents>>(eventName: K, data: TEvents[K]): void {
    const errors: unknown[] = [];
    for (const callback of [...(this.handlerMap.get(eventName) ?? [])]) {
      try {
        callback(data);
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `listeners for ${String(eventName)} failed`,
      );
    }
  }

  clearListeners(): void {
    this.handlerMap.clear();
  }
}

export class VexEventTarget<
  TEvents extends object = Record<EventName, unknown>,
> {
  emitter: VexEventEmitter<TEvents>;

  constructor() {
    this.emitter = new VexEventEmitter<TEvents>();
  }

  emit<K extends EventMapKey<TEvents>>(eventName: K, data: TEvents[K]): void {
    this.emitter.emit(eventName, data);
  }

  on<K extends EventMapKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    this.emitter.on(eventName, listener);
  }

  remove<K extends EventMapKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    this.emitter.remove(eventName, listener);
  }

  clearListeners(): void {
    this.emitter.clearListeners();
  }
}
