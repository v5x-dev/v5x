import {
  createV5ClientWithFactory,
  type V5Client,
} from "@v5x/web/client-internal";

export type FailureMode =
  | "none"
  | "connect-failed"
  | "connect-error"
  | "refresh-error"
  | "disconnect-error";

export interface FakeV5Stats {
  connects: number;
  refreshes: number;
  disconnects: number;
  disposed: number;
}

export interface FakeV5Controls {
  readonly mode: FailureMode;
  readonly stats: FakeV5Stats;
  setMode(mode: FailureMode): void;
  resetStats(): void;
  subscribe(listener: () => void): () => void;
}

export interface FakeV5Environment {
  client: V5Client;
  controls: FakeV5Controls;
}

export const failureModes: readonly FailureMode[] = [
  "none",
  "connect-failed",
  "connect-error",
  "refresh-error",
  "disconnect-error",
];

class FakeSerial extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  async getPorts(): Promise<SerialPort[]> {
    return [];
  }

  async requestPort(): Promise<SerialPort> {
    throw new Error("The browser example uses an injected fake V5 device.");
  }
}

class FakeControls implements FakeV5Controls {
  #mode: FailureMode;
  #stats: FakeV5Stats = {
    connects: 0,
    refreshes: 0,
    disconnects: 0,
    disposed: 0,
  };
  #listeners = new Set<() => void>();

  constructor(mode: FailureMode) {
    this.#mode = mode;
  }

  get mode(): FailureMode {
    return this.#mode;
  }

  get stats(): FakeV5Stats {
    return { ...this.#stats };
  }

  setMode(mode: FailureMode): void {
    this.#mode = mode;
    this.#emit();
  }

  resetStats(): void {
    this.#stats = {
      connects: 0,
      refreshes: 0,
      disconnects: 0,
      disposed: 0,
    };
    this.#emit();
  }

  increment(key: keyof FakeV5Stats): void {
    this.#stats = { ...this.#stats, [key]: this.#stats[key] + 1 };
    this.#emit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

class FakeV5Device {
  autoRefresh = false;
  #connected = false;
  readonly #controls: FakeControls;

  constructor(controls: FakeControls) {
    this.#controls = controls;
  }

  async connect(): Promise<boolean> {
    await delay();
    this.#controls.increment("connects");

    if (this.#controls.mode === "connect-failed") return false;
    if (this.#controls.mode === "connect-error") {
      throw new Error("Fake serial connect error.");
    }

    this.#connected = true;
    return true;
  }

  async refresh(): Promise<void> {
    await delay();
    this.#controls.increment("refreshes");

    if (this.#controls.mode === "refresh-error") {
      throw new Error("Fake serial refresh error.");
    }
  }

  async disconnect(): Promise<void> {
    await delay();
    this.#controls.increment("disconnects");

    if (this.#controls.mode === "disconnect-error") {
      throw new Error("Fake serial disconnect error.");
    }

    this.#connected = false;
  }

  async dispose(): Promise<void> {
    this.#controls.increment("disposed");
    if (this.#connected) await this.disconnect();
  }
}

export function createFakeV5Environment(options: {
  supported: boolean;
  mode?: FailureMode;
}): FakeV5Environment {
  const controls = new FakeControls(options.mode ?? "none");
  const serial = options.supported ? new FakeSerial() : undefined;
  const client = createV5ClientWithFactory({ serial }, () => {
    return new FakeV5Device(controls);
  });

  return { client, controls };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 180));
}
