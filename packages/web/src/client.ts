import { V5SerialDevice } from "@v5x/serial";
import { V5WebError, normalizeV5WebError } from "./errors.js";
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
  status: V5ConnectionStatus;
  supported: boolean;
  unavailableReason: string | null;
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
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
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  dispose?: () => Promise<void>;
  refresh(): Promise<unknown>;
}

type V5DeviceFactory = (serial: Serial) => V5DeviceLike;

interface V5ClientInternals {
  createDevice: V5DeviceFactory;
}

const createDefaultDevice: V5DeviceFactory = (serial) => {
  const device = new V5SerialDevice(serial);
  device.autoRefresh = false;
  return device;
};

function createSnapshot(
  status: V5ConnectionStatus,
  supported: boolean,
  unavailableReason: string | null,
  error: V5WebError | null,
): V5Snapshot {
  return {
    status,
    supported,
    unavailableReason,
    connected: status === "connected",
    connecting: status === "connecting",
    disconnecting: status === "disconnecting",
    error,
  };
}

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

  constructor(options: V5ClientOptions, internals: V5ClientInternals) {
    this.serial = options.serial ?? getDefaultSerial();
    this.supported = isWebSerialSupported(this.serial);
    this.unavailableReason = getWebSerialUnavailableReason(this.serial);
    this.refreshIntervalMs = options.refreshIntervalMs;
    this.createDevice = internals.createDevice;
    this.status = this.supported ? "idle" : "unsupported";
  }

  getSnapshot(): V5Snapshot {
    return createSnapshot(
      this.status,
      this.supported,
      this.unavailableReason,
      this.error,
    );
  }

  subscribe(listener: () => void): V5Unsubscribe {
    return this.listeners.subscribe(listener);
  }

  async connect(): Promise<boolean> {
    if (!this.supported || this.serial === undefined) return false;
    if (this.status === "connected") return true;
    if (this.status === "connecting") return false;

    this.setState("connecting", null);
    let device: V5DeviceLike | null = null;

    try {
      device = this.device ?? this.createDevice(this.serial);
      device.autoRefresh = false;
      const connected = await device.connect();
      if (!connected) {
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
      const normalized = normalizeV5WebError(
        "connect-error",
        error,
        "V5 device connection threw an unknown error.",
      );
      this.device = null;
      this.stopRefreshTimer();
      if (device !== null) {
        await this.tryDisposeDevice(device);
      }
      this.setState("error", normalized);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status === "unsupported") return;
    if (this.status === "disconnecting") return;

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
      this.setState(
        "error",
        normalizeV5WebError(
          "disconnect-error",
          error,
          "V5 device disconnect threw an unknown error.",
        ),
      );
    }
  }

  async refresh(): Promise<void> {
    if (this.device === null || this.status !== "connected") return;

    try {
      await this.device.refresh();
      this.listeners.emit();
    } catch (error: unknown) {
      this.setState(
        "error",
        normalizeV5WebError(
          "refresh-error",
          error,
          "V5 device refresh threw an unknown error.",
        ),
      );
    }
  }

  private setState(status: V5ConnectionStatus, error: V5WebError | null): void {
    this.status = status;
    this.error = error;
    this.listeners.emit();
  }

  private startRefreshTimer(): void {
    this.stopRefreshTimer();
    if (this.refreshIntervalMs === undefined || this.refreshIntervalMs <= 0) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.refreshIntervalMs);
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer === undefined) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private async disposeDevice(device: V5DeviceLike): Promise<void> {
    if (device.dispose !== undefined) {
      await device.dispose();
      return;
    }
    await device.disconnect();
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
  return createV5ClientWithFactory(options, createDefaultDevice);
}

export function createV5ClientWithFactory(
  options: V5ClientOptions,
  createDevice: V5DeviceFactory,
): V5Client {
  return new V5WebClient(options, { createDevice });
}

export type { V5Store, V5Unsubscribe };
