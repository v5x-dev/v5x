import { V5SerialDevice, type VexSerialError } from "@v5x/serial";
import { ResultAsync } from "neverthrow";
import {
  createDeviceSnapshot,
  type V5DeviceSnapshot,
  type V5ReadableDeviceState,
} from "./device-snapshot.js";
import {
  V5WebError,
  normalizeV5WebError,
  type V5WebErrorCode,
} from "./errors.js";
import {
  getDefaultSerial,
  getWebSerialUnavailableReason,
  isWebSerialSupported,
  type WebSerialUnavailableReason,
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
  unavailableReason: WebSerialUnavailableReason | null;
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
  device: V5DeviceSnapshot | null;
  deviceVersion: number;
}

export interface V5ClientOptions {
  serial?: Serial;
  /**
   * Background refresh interval in milliseconds. When provided, this must be
   * a positive finite number.
   */
  refreshIntervalMs?: number;
}

export interface V5Client extends V5Store<V5Snapshot> {
  getSnapshot(): V5Snapshot;
  subscribe(listener: () => void): V5Unsubscribe;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export interface V5DeviceLike {
  autoRefresh: boolean;
  autoReconnect?: boolean;
  state?: V5ReadableDeviceState;
  connect(): ResultAsync<void, VexSerialError>;
  disconnect(): Promise<void>;
  dispose?: () => Promise<void>;
  refresh(): ResultAsync<boolean, VexSerialError>;
  on?: <TEventName extends V5DeviceEventName>(
    eventName: TEventName,
    listener: V5DeviceEventListener<TEventName>,
  ) => void;
  remove?: <TEventName extends V5DeviceEventName>(
    eventName: TEventName,
    listener: V5DeviceEventListener<TEventName>,
  ) => void;
}

export type V5DeviceFactory = (serial: Serial) => V5DeviceLike;

type V5DeviceEventName = "disconnected" | "error";

type V5DeviceEventListener<TEventName extends V5DeviceEventName> =
  TEventName extends "disconnected" ? () => void : (error: unknown) => void;

const createDefaultDevice: V5DeviceFactory = (serial) => {
  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;
  return device;
};

class V5WebClient implements V5Client {
  private readonly serial: Serial | undefined;
  private readonly supported: boolean;
  private readonly unavailableReason: WebSerialUnavailableReason | null;
  private readonly refreshIntervalMs: number | undefined;
  private readonly createDevice: V5DeviceFactory;
  private readonly listeners = createListenerSet();
  private status: V5ConnectionStatus;
  private error: V5WebError | null = null;
  private device: V5DeviceLike | null = null;
  private deviceSnapshot: V5DeviceSnapshot | null = null;
  private deviceVersion = 0;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private connectPromise: Promise<boolean> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private generation = 0;
  private detachDeviceListeners: (() => void) | null = null;
  private snapshot: V5Snapshot;

  constructor(options: V5ClientOptions, createDevice: V5DeviceFactory) {
    if (
      options.refreshIntervalMs !== undefined &&
      (!Number.isFinite(options.refreshIntervalMs) ||
        options.refreshIntervalMs <= 0)
    ) {
      throw new RangeError(
        "refreshIntervalMs must be a positive finite number",
      );
    }
    this.serial = options.serial ?? getDefaultSerial();
    this.supported = isWebSerialSupported(this.serial);
    this.unavailableReason = getWebSerialUnavailableReason(this.serial);
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.createDevice = createDevice;
    this.status = this.supported ? "idle" : "unsupported";
    this.snapshot = this.createSnapshot();
  }

  getSnapshot(): V5Snapshot {
    return this.snapshot;
  }

  private createSnapshot(): V5Snapshot {
    const { status } = this;
    return {
      status,
      supported: this.supported,
      unavailableReason: this.unavailableReason,
      connected: status === "connected",
      connecting: status === "connecting",
      disconnecting: status === "disconnecting",
      error: this.error,
      device: this.deviceSnapshot,
      deviceVersion: this.deviceVersion,
    };
  }

  subscribe(listener: () => void): V5Unsubscribe {
    return this.listeners.subscribe(listener);
  }

  connect(): Promise<boolean> {
    if (!this.supported || this.serial === undefined) {
      return Promise.resolve(false);
    }
    if (this.status === "connected" && this.device !== null) {
      return Promise.resolve(true);
    }
    if (this.status === "connecting" && this.connectPromise !== null) {
      return this.connectPromise;
    }
    if (this.status === "disconnecting") return Promise.resolve(false);

    const connectPromise = this.runConnect(this.serial);
    this.connectPromise = connectPromise;
    void connectPromise.then(() => {
      if (this.connectPromise === connectPromise) this.connectPromise = null;
    });
    return connectPromise;
  }

  private async runConnect(serial: Serial): Promise<boolean> {
    const generation = ++this.generation;
    this.setState("connecting", null, null);
    let device: V5DeviceLike | null = null;

    try {
      device = this.device ?? this.createDevice(serial);
      device.autoRefresh = false;
      device.autoReconnect = false;
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
          null,
        );
        return false;
      }

      this.device = device;
      this.attachDeviceListeners(device, generation);
      this.setState("connected", null, createDeviceSnapshot(device.state));
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

    const device = this.teardownDevice();

    if (device === null) {
      if (this.status !== "idle") this.setState("idle", null, null);
      return;
    }

    const generation = this.generation;
    this.setState("disconnecting", null, null);

    try {
      await this.disposeDevice(device);
      if (generation === this.generation) this.setState("idle", null, null);
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.fail(
        "disconnect-error",
        error,
        "V5 device disconnect threw an unknown error.",
      );
    }
  }

  async refresh(): Promise<void> {
    if (this.device === null || this.status !== "connected") return;
    if (this.refreshPromise !== null) return this.refreshPromise;

    const refreshPromise = this.runRefresh();
    this.refreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    }
  }

  private async runRefresh(): Promise<void> {
    const device = this.device;
    const generation = this.generation;
    if (device === null || this.status !== "connected") return;

    try {
      const result = await device.refresh();
      if (generation !== this.generation || this.device !== device) return;
      if (result.isErr()) {
        await this.handleRefreshFailure(
          result.error,
          "V5 device refresh failed.",
          device,
          generation,
        );
      } else if (!result.value) {
        await this.handleRefreshFailure(
          undefined,
          "V5 device refresh did not produce a current snapshot.",
          device,
          generation,
        );
      } else {
        this.publishDeviceSnapshot(device);
      }
    } catch (error: unknown) {
      if (generation !== this.generation || this.device !== device) return;
      await this.handleRefreshFailure(
        error,
        "V5 device refresh threw an unknown error.",
        device,
        generation,
      );
    }
  }

  private setState(
    status: V5ConnectionStatus,
    error: V5WebError | null,
    deviceSnapshot: V5DeviceSnapshot | null,
  ): void {
    this.status = status;
    this.error = error;
    this.setDeviceSnapshot(deviceSnapshot);
    this.snapshot = this.createSnapshot();
    this.listeners.emit();
  }

  private fail(code: V5WebErrorCode, error: unknown, fallback: string): void {
    this.setState("error", normalizeV5WebError(code, error, fallback), null);
  }

  private async handleRefreshFailure(
    error: unknown,
    fallback: string,
    device: V5DeviceLike | null = this.device,
    generation: number = this.generation,
  ): Promise<void> {
    if (generation !== this.generation || device !== this.device) return;
    const normalizedError = normalizeV5WebError(
      "refresh-error",
      error,
      fallback,
    );

    this.teardownDevice();
    this.setState("error", normalizedError, null);

    if (device !== null) {
      await this.tryDisposeDevice(device);
    }
  }

  /**
   * Detaches the current device and invalidates in-flight lifecycle work,
   * returning the detached device for optional disposal.
   */
  private teardownDevice(): V5DeviceLike | null {
    this.generation++;
    const device = this.device;
    this.device = null;
    this.refreshPromise = null;
    this.detachDeviceListeners?.();
    this.detachDeviceListeners = null;
    this.stopRefreshTimer();
    return device;
  }

  private attachDeviceListeners(
    device: V5DeviceLike,
    generation: number,
  ): void {
    this.detachDeviceListeners?.();

    const onDisconnected = (): void => {
      if (generation !== this.generation || this.device !== device) return;
      void this.handleDeviceDisconnect(device, generation);
    };
    const onError = (error: unknown): void => {
      if (generation !== this.generation || this.device !== device) return;
      void this.handleRefreshFailure(
        error,
        "V5 device emitted an unknown error.",
        device,
        generation,
      );
    };

    device.on?.("disconnected", onDisconnected);
    device.on?.("error", onError);
    this.detachDeviceListeners = () => {
      device.remove?.("disconnected", onDisconnected);
      device.remove?.("error", onError);
    };
  }

  private async handleDeviceDisconnect(
    device: V5DeviceLike,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation || this.device !== device) return;

    this.teardownDevice();
    this.setState(
      "error",
      new V5WebError("disconnect-error", "V5 device disconnected."),
      null,
    );
    await this.tryDisposeDevice(device);
  }

  private publishDeviceSnapshot(device: V5DeviceLike): void {
    const snapshot = createDeviceSnapshot(device.state, this.deviceSnapshot);
    if (snapshot === this.deviceSnapshot) return;
    this.setDeviceSnapshot(snapshot);
    this.snapshot = this.createSnapshot();
    this.listeners.emit();
  }

  private setDeviceSnapshot(snapshot: V5DeviceSnapshot | null): void {
    if (snapshot === this.deviceSnapshot) return;
    this.deviceSnapshot = snapshot;
    this.deviceVersion++;
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

export type { V5DeviceSnapshot, V5Store, V5Unsubscribe };
