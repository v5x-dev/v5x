import type {
  NativeOpenOptions,
  NativePort,
  NativePortDescriptor,
  NativePortEventMap,
  SerialBackend,
} from "./backend.js";

type Listener = (value: never) => void;

/** An in-memory native port that tests drive directly. */
export class FakeNativePort implements NativePort {
  readonly writes: Uint8Array[] = [];
  pauses = 0;
  resumes = 0;
  /** Blocks `close()` until resolved, to model a slow native close. */
  closeGate: Promise<void> | undefined;
  closeError: Error | undefined;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly options: NativeOpenOptions) {}

  async close(): Promise<void> {
    await this.closeGate;
    if (this.closeError !== undefined) {
      const error = this.closeError;
      this.closeError = undefined;
      throw error;
    }
  }

  pause: (() => void) | undefined = () => {
    this.pauses++;
  };

  resume: (() => void) | undefined = () => {
    this.resumes++;
  };

  async write(data: Uint8Array): Promise<number> {
    this.writes.push(data);
    return data.byteLength;
  }

  on<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: (value: NativePortEventMap[Event]) => void,
  ): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(event, listeners);
  }

  off<Event extends keyof NativePortEventMap>(
    event: Event,
    listener: (value: NativePortEventMap[Event]) => void,
  ): void {
    this.listeners.get(event)?.delete(listener as Listener);
  }

  emit<Event extends keyof NativePortEventMap>(
    event: Event,
    value: NativePortEventMap[Event],
  ): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (value: NativePortEventMap[Event]) => void)(value);
    }
  }

  listenerCount(event: keyof NativePortEventMap): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export interface FakeBackend extends SerialBackend {
  readonly opened: FakeNativePort[];
}

export function createFakeBackend(
  list: () => Promise<NativePortDescriptor[]>,
  platforms?: readonly NodeJS.Platform[],
): FakeBackend {
  const opened: FakeNativePort[] = [];
  return {
    name: "fake",
    platforms,
    opened,
    list,
    async open(options: NativeOpenOptions): Promise<NativePort> {
      const port = new FakeNativePort(options);
      opened.push(port);
      return port;
    },
  };
}
