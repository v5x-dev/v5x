import {
  createV5ClientWithFactory,
  type V5Client,
} from "@v5x/web/client-internal";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { VexSerialError } from "@v5x/serial";

export type FailureMode =
  | "none"
  | "connect-failed"
  | "connect-error"
  | "refresh-error"
  | "disconnect-error";

export const failureModes: readonly FailureMode[] = [
  "none",
  "connect-failed",
  "connect-error",
  "refresh-error",
  "disconnect-error",
];

export interface FakeV5Stats {
  connects: number;
  refreshes: number;
  disconnects: number;
  disposed: number;
}

export interface FakeV5Controls {
  readonly mode: FailureMode;
  /** Replaced (never mutated) on change, so the reference works as a snapshot. */
  readonly stats: FakeV5Stats;
  setMode(mode: FailureMode): void;
  resetStats(): void;
  subscribe(listener: () => void): () => void;
}

export interface FakeV5Environment {
  client: V5Client;
  controls: FakeV5Controls;
}

const zeroStats = (): FakeV5Stats => ({
  connects: 0,
  refreshes: 0,
  disconnects: 0,
  disposed: 0,
});

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
  #stats = zeroStats();
  #listeners = new Set<() => void>();

  constructor(mode: FailureMode) {
    this.#mode = mode;
  }

  get mode(): FailureMode {
    return this.#mode;
  }

  get stats(): FakeV5Stats {
    return this.#stats;
  }

  setMode(mode: FailureMode): void {
    this.#mode = mode;
    this.#emit();
  }

  resetStats(): void {
    this.#stats = zeroStats();
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

  constructor(private readonly controls: FakeControls) {}

  connect(): ResultAsync<void, VexSerialError> {
    return new ResultAsync(this.#connect());
  }

  async #connect(): Promise<Result<void, VexSerialError>> {
    await delay();
    this.controls.increment("connects");

    switch (this.controls.mode) {
      case "connect-failed":
        return err(new VexSerialError("io", "Fake serial connect failed."));
      case "connect-error":
        throw new Error("Fake serial connect error.");
      default:
        this.#connected = true;
        return ok(undefined);
    }
  }

  refresh(): ResultAsync<boolean, VexSerialError> {
    return new ResultAsync(this.#refresh());
  }

  async #refresh(): Promise<Result<boolean, VexSerialError>> {
    await delay();
    this.controls.increment("refreshes");
    return this.controls.mode === "refresh-error"
      ? err(new VexSerialError("io", "Fake serial refresh error."))
      : ok(true);
  }

  async disconnect(): Promise<void> {
    await delay();
    this.controls.increment("disconnects");
    if (this.controls.mode === "disconnect-error") {
      throw new Error("Fake serial disconnect error.");
    }
    this.#connected = false;
  }

  async dispose(): Promise<void> {
    this.controls.increment("disposed");
    if (this.#connected) await this.disconnect();
  }
}

export function createFakeV5Environment(options: {
  supported: boolean;
  mode?: FailureMode;
}): FakeV5Environment {
  const controls = new FakeControls(options.mode ?? "none");
  const serial = options.supported ? new FakeSerial() : undefined;
  const client = createV5ClientWithFactory(
    { serial },
    () => new FakeV5Device(controls),
  );

  return { client, controls };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 180));
}
