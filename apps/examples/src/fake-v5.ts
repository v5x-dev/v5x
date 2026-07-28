import { createV5ClientWithFactory, type V5Client } from "@v5x/web/testing";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { VexSerialError, type V5UserProgramTerminal } from "@v5x/serial";

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

/** Lines the fake user program "prints", cycled while a console is open. */
const programOutput = [
  "[auton] initialize()\n",
  "[auton] imu calibrated in 2.1 s\n",
  "[drive] left 127 right 127\n",
  "[odom] x=12.4 y=-3.1 theta=88.7\n",
  "[intake] ring detected, stowing\n",
];

/**
 * A stand-in for the serial terminal session. It emits scripted program output
 * on a timer so the console panels have something to render without hardware.
 */
class FakeTerminal {
  #textListeners = new Set<(value: string) => void>();
  #closedListeners = new Set<() => void>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #line = 0;

  constructor() {
    this.#timer = setInterval(() => {
      const text = programOutput[this.#line++ % programOutput.length]!;
      for (const listener of this.#textListeners) listener(text);
    }, 700);
  }

  on(event: string, listener: (value: string) => void): void {
    if (event === "text") this.#textListeners.add(listener);
    if (event === "closed") this.#closedListeners.add(listener as () => void);
  }

  remove(event: string, listener: (value: string) => void): void {
    if (event === "text") this.#textListeners.delete(listener);
    if (event === "closed") {
      this.#closedListeners.delete(listener as () => void);
    }
  }

  write(data: string | Uint8Array): ResultAsync<number, VexSerialError> {
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    for (const listener of this.#textListeners) listener(`[stdin] ${text}`);
    return new ResultAsync(Promise.resolve(ok(text.length)));
  }

  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#textListeners.clear();
    this.#closedListeners.clear();
  }
}

class FakeV5Device {
  autoRefresh = false;
  #connected = false;

  constructor(private readonly controls: FakeControls) {}

  openTerminal(): Result<V5UserProgramTerminal, VexSerialError> {
    if (!this.#connected) {
      return err(new VexSerialError("not-connected", "Fake V5 is offline."));
    }
    return ok(new FakeTerminal() as unknown as V5UserProgramTerminal);
  }

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
