import { V5SerialDevice, type VexSerialError } from "@v5x/serial";
import { ResultAsync } from "neverthrow";
import {
  V5WebError,
  normalizeV5WebError,
  type V5WebErrorCode,
} from "./errors.js";
import {
  getDefaultSerial,
  getWebSerialUnavailableReason,
  isWebSerialSupported,
} from "./support.js";
import {
  createListenerSet,
  type V5Store,
  type V5Unsubscribe,
} from "./store.js";

export type V5ConnectionStatus =
  | "unsupported"
  | "idle"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export interface V5Snapshot {
  /**
   * Current connection lifecycle state.
   *
   * Refresh failures move the client to `error`, stop background refresh,
   * detach and dispose the stale device, and leave recovery to an explicit
   * `connect()` call. Calling `disconnect()` from `error` clears the error and
   * returns the client to `idle`.
   */
  status: V5ConnectionStatus;
  supported: boolean;
  unavailableReason: string | null;
  /**
   * True only while the client has a live attached device. Refresh failures
   * clear the attached device before publishing the `error` snapshot.
   */
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  /**
   * Normalized lifecycle error for the current `error` snapshot. Refresh
   * failures use `refresh-error` and remain visible until `connect()` starts a
   * fresh attempt or `disconnect()` returns the client to `idle`.
   */
  error: V5WebError | null;
}

export interface V5ClientOptions {
  serial?: Serial;
  refreshIntervalMs?: number;
}

export interface V5Client extends V5Store<V5Snapshot> {
  getSnapshot(): V5Snapshot;
  subscribe(listener: () => void): V5Unsubscribe;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

interface V5DeviceLike {
  autoRefresh: boolean;
  connect(): ResultAsync<void, VexSerialError>;
  disconnect(): Promise<void>;
  dispose?: () => Promise<void>;
  refresh(): ResultAsync<boolean, VexSerialError>;
}

type V5DeviceFactory = (serial: Serial) => V5DeviceLike;

const createDefaultDevice: V5DeviceFactory = (serial) => {
  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;
  return device;
};

class V5WebClient implements V5Client {
  private readonly serial: Serial | undefined;
  private readonly supported: boolean;
  private readonly unavailableReason: string | null;
  private readonly refreshIntervalMs: number | undefined;
  private readonly createDevice: V5DeviceFactory;
  private readonly listeners = createListenerSet();
  private status: V5ConnectionStatus;
  private error: V5WebError | null = null;
  private device: V5DeviceLike | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;

  constructor(options: V5ClientOptions, createDevice: V5DeviceFactory) {
    this.serial = options.serial ?? getDefaultSerial();
    this.supported = isWebSerialSupported(this.serial);
    this.unavailableReason = getWebSerialUnavailableReason(this.serial);
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.createDevice = createDevice;
    this.status = this.supported ? "idle" : "unsupported";
  }

  getSnapshot(): V5Snapshot {
    const { status } = this;
    return {
      status,
      supported: this.supported,
      unavailableReason: this.unavailableReason,
      connected: status === "connected",
      connecting: status === "connecting",
      disconnecting: status === "disconnecting",
      error: this.error,
    };
  }

  subscribe(listener: () => void): V5Unsubscribe {
    return this.listeners.subscribe(listener);
  }

  async connect(): Promise<boolean> {
    if (!this.supported || this.serial === undefined) return false;
    if (this.status === "connected") return true;
    if (this.status === "connecting") return false;

    const generation = ++this.generation;
    this.setState("connecting", null);
    let device: V5DeviceLike | null = null;

    try {
      device = this.device ?? this.createDevice(this.serial);
      device.autoRefresh = false;
      const result = await device.connect();

      // A disconnect() during the in-flight connect supersedes this attempt.
      if (generation !== this.generation) {
        this.device = null;
        await this.tryDisposeDevice(device);
        return false;
      }

      if (result.isErr()) {
        this.device = null;
        await this.disposeDevice(device);
        this.setState(
          "error",
          new V5WebError("connect-failed", "V5 device connection failed."),
        );
        return false;
      }

      this.device = device;
      this.setState("connected", null);
      this.startRefreshTimer();
      return true;
    } catch (error: unknown) {
      this.device = null;
      if (device !== null) {
        await this.tryDisposeDevice(device);
        if (generation !== this.generation) return false;
      }
      this.stopRefreshTimer();
      this.fail(
        "connect-error",
        error,
        "V5 device connection threw an unknown error.",
      );
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status === "unsupported" || this.status === "disconnecting") {
      return;
    }

    this.generation++;
    const device = this.device;
    this.device = null;
    this.stopRefreshTimer();

    if (device === null) {
      if (this.status !== "idle") this.setState("idle", null);
      return;
    }

    this.setState("disconnecting", null);

    try {
      await this.disposeDevice(device);
      this.setState("idle", null);
    } catch (error: unknown) {
      this.fail(
        "disconnect-error",
        error,
        "V5 device disconnect threw an unknown error.",
      );
    }
  }

  async refresh(): Promise<void> {
    if (this.device === null || this.status !== "connected") return;

    try {
      const result = await this.device.refresh();
      if (result.isErr()) {
        await this.handleRefreshFailure(
          result.error,
          "V5 device refresh failed.",
        );
      } else {
        this.listeners.emit();
      }
    } catch (error: unknown) {
      await this.handleRefreshFailure(
        error,
        "V5 device refresh threw an unknown error.",
      );
    }
  }

  private setState(status: V5ConnectionStatus, error: V5WebError | null): void {
    this.status = status;
    this.error = error;
    this.listeners.emit();
  }

  private fail(code: V5WebErrorCode, error: unknown, fallback: string): void {
    this.setState("error", normalizeV5WebError(code, error, fallback));
  }

  private async handleRefreshFailure(
    error: unknown,
    fallback: string,
  ): Promise<void> {
    const normalizedError = normalizeV5WebError(
      "refresh-error",
      error,
      fallback,
    );
    const device = this.device;

    this.generation++;
    this.device = null;
    this.stopRefreshTimer();

    if (device !== null) {
      await this.tryDisposeDevice(device);
    }

    this.setState("error", normalizedError);
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    const interval = this.refreshIntervalMs;
    if (interval === undefined || interval <= 0) return;
    this.refreshTimer = setInterval(() => void this.refresh(), interval);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer === undefined) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private disposeDevice(device: V5DeviceLike): Promise<void> {
    return device.dispose?.() ?? device.disconnect();
  }

  private async tryDisposeDevice(device: V5DeviceLike): Promise<void> {
    try {
      await this.disposeDevice(device);
    } catch {
      // Preserve the original lifecycle error when cleanup also fails.
    }
  }
}

export function createV5Client(options: V5ClientOptions = {}): V5Client {
  return new V5WebClient(options, createDefaultDevice);
}

export function createV5ClientWithFactory(
  options: V5ClientOptions,
  createDevice: V5DeviceFactory,
): V5Client {
  return new V5WebClient(options, createDevice);
}

export type { V5Store, V5Unsubscribe };
