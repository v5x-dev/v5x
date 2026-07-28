import { type MatchMode, SerialDeviceType } from "./vex.js";
import { DEFAULT_MAX_FILE_DOWNLOAD_BYTES } from "./connection.js";
import { V5SerialConnection } from "./v5-serial-connection.js";
import {
  V5Brain,
  V5Controller,
  V5Radio,
  V5SerialDeviceState,
  V5SmartDevice,
  VexSerialDevice,
  type VexSerialDeviceEvents,
} from "./device-state.js";
import {
  VexInvalidArgumentError,
  VexNotConnectedError,
  VexSerialError,
} from "./error.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { DeviceSnapshotRefresher } from "./device-snapshot-refresher.js";
import {
  openUserProgramTerminal,
  type V5TerminalOptions,
  type V5UserProgramTerminal,
} from "./terminal.js";
import { ConnectionLifecycle } from "./connection-lifecycle.js";

// Re-exports for backward compatibility with the previous VexDevice module.
export {
  VexSerialDevice,
  V5Brain,
  V5Battery,
  V5BrainButton,
  V5BrainSettings,
  V5Controller,
  V5SmartDevice,
  V5Radio,
  V5SerialDeviceState,
} from "./device-state.js";
export { downloadFileFromInternet, uploadFirmware } from "./firmware.js";
export { sleep, sleepUntil, sleepUntilAsync } from "./timing.js";

type RefreshTimer = ReturnType<typeof setInterval>;

export interface V5SerialDeviceOptions {
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
  /** Maximum file size accepted from a connected device before allocation. */
  maxFileDownloadBytes?: number;
}

function unrefTimerIfPossible(timer: RefreshTimer): void {
  if (typeof timer !== "object" || timer === null || !("unref" in timer))
    return;

  const unref = timer.unref;
  if (typeof unref === "function") unref.call(timer);
}

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true;
  pauseRefreshOnFileTransfer = true;

  private _refreshInterval: RefreshTimer | undefined;
  state: V5SerialDeviceState = new V5SerialDeviceState(this);
  private readonly lifecycle: ConnectionLifecycle;
  private readonly snapshots = new DeviceSnapshotRefresher(
    this.state,
    () => this.lifecycle.isDisposed,
    () => this.isV5Controller,
  );
  private _autoRefresh = false;
  private _refreshIntervalMs = 200;
  private readonly _maxFileDownloadBytes: number;
  private _isLastRefreshComplete = true;
  private readonly _brain = new V5Brain(this.state);
  private readonly _controllers: [V5Controller, V5Controller] = [
    new V5Controller(this.state, 0),
    new V5Controller(this.state, 1),
  ];
  private readonly _radio = new V5Radio(this.state);
  private readonly _deviceFacades: Array<V5SmartDevice | undefined> = [];
  private _devicesSource: V5SerialDeviceState["devices"] | undefined;
  private _devices: V5SmartDevice[] = [];

  /**
   * Device lifecycle events are notifications only: consumer callbacks must
   * not alter automatic refresh or reconnect work that produced them.
   */
  private _emitSafely<K extends keyof VexSerialDeviceEvents>(
    eventName: K,
    data: VexSerialDeviceEvents[K],
  ): void {
    try {
      this.emit(eventName, data);
    } catch {
      // The emitter invokes every listener before rethrowing their failures.
      // Suppress that aggregate here because this is library-owned control
      // flow, not an application-owned direct emit call.
    }
  }

  constructor(
    defaultSerial: Serial,
    options: boolean | V5SerialDeviceOptions = false,
  ) {
    super(defaultSerial);
    const autoRefresh =
      typeof options === "boolean" ? options : (options.autoRefresh ?? false);
    this.refreshIntervalMs =
      typeof options === "boolean" ? 200 : (options.refreshIntervalMs ?? 200);
    const maxFileDownloadBytes =
      typeof options === "boolean"
        ? DEFAULT_MAX_FILE_DOWNLOAD_BYTES
        : (options.maxFileDownloadBytes ?? DEFAULT_MAX_FILE_DOWNLOAD_BYTES);
    if (
      !Number.isSafeInteger(maxFileDownloadBytes) ||
      maxFileDownloadBytes <= 0
    ) {
      throw new VexInvalidArgumentError(
        "maxFileDownloadBytes must be a positive safe integer",
      );
    }
    this._maxFileDownloadBytes = maxFileDownloadBytes;
    this.lifecycle = new ConnectionLifecycle({
      getSerial: () => this.defaultSerial,
      getConnection: () => this.connection,
      setConnection: (connection) => {
        this.connection = connection;
      },
      createConnection: () => this.createConnection(),
      invalidateSnapshots: () => this.snapshots.invalidate(),
      refresh: () => this.refresh(),
      getBrainUniqueId: () => this.brain.uniqueId,
      getAutoReconnect: () => this.autoReconnect,
      setAutoReconnect: (value) => {
        this.autoReconnect = value;
      },
      setAutoRefresh: (value) => {
        this.autoRefresh = value;
      },
      emitDisconnected: () => this._emitSafely("disconnected", undefined),
      emitError: (error) => this._emitSafely("error", error),
      reconnect: () => this.reconnect(),
    });
    this.autoRefresh = autoRefresh;
  }

  protected get _isReconnecting(): boolean {
    return this.lifecycle.isReconnecting;
  }

  get autoRefresh(): boolean {
    return this._autoRefresh;
  }

  set autoRefresh(value: boolean) {
    if (this._autoRefresh === value) return;
    this._autoRefresh = value;
    if (value) {
      this._startRefreshInterval();
    } else {
      this._stopRefreshInterval();
    }
  }

  get refreshIntervalMs(): number {
    return this._refreshIntervalMs;
  }

  set refreshIntervalMs(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new VexInvalidArgumentError(
        "refreshIntervalMs must be a positive finite number",
      );
    }
    if (this._refreshIntervalMs === value) return;

    this._refreshIntervalMs = value;
    if (this._refreshInterval !== undefined) {
      this._stopRefreshInterval();
      this._startRefreshInterval();
    }
  }

  private _startRefreshInterval(): void {
    if (this._refreshInterval !== undefined || this.lifecycle.isDisposed)
      return;
    this._refreshInterval = setInterval(() => {
      if (this.lifecycle.isDisposed) return;
      if (this._autoRefresh && this._isLastRefreshComplete) {
        if (!this.isConnected) {
          this.state.brain.isAvailable = false;
          return;
        }

        if (!this.pauseRefreshOnFileTransfer || !this.state.isRefreshPaused) {
          this._isLastRefreshComplete = false;
          void (async () => {
            try {
              const r = await this.refresh();
              if (r.isErr()) this._emitSafely("error", r.error);
            } catch (error: unknown) {
              this._emitSafely("error", error);
            } finally {
              this._isLastRefreshComplete = true;
            }
          })();
        }
      }
    }, this._refreshIntervalMs);
    unrefTimerIfPossible(this._refreshInterval);
  }

  private _stopRefreshInterval(): void {
    if (this._refreshInterval === undefined) return;
    clearInterval(this._refreshInterval);
    this._refreshInterval = undefined;
  }

  get isV5Controller(): boolean {
    return this.deviceType === SerialDeviceType.V5_CONTROLLER;
  }

  get brain(): V5Brain {
    return this._brain;
  }

  get controllers(): [V5Controller, V5Controller] {
    return this._controllers;
  }

  get devices(): V5SmartDevice[] {
    // The snapshot refresher replaces state.devices (never mutates it in
    // place), so array identity is a reliable memoization key.
    if (this._devicesSource === this.state.devices) return this._devices;

    const devices: V5SmartDevice[] = [];
    for (let i = 1; i < this.state.devices.length; i++) {
      if (this.state.devices[i] != null) {
        const facade =
          this._deviceFacades[i] ?? new V5SmartDevice(this.state, i);
        this._deviceFacades[i] = facade;
        devices.push(facade);
      }
    }
    this._devicesSource = this.state.devices;
    this._devices = devices;
    return devices;
  }

  get isFieldControllerConnected(): boolean {
    return this.state.isFieldControllerConnected;
  }

  get matchMode(): MatchMode {
    return this.state.matchMode;
  }

  /**
   * @deprecated Setting this property dispatches a fire-and-forget
   * request whose result cannot be observed. Use {@link setMatchMode}
   * instead, which returns a {@link ResultAsync} that resolves to an
   * error result when the device refuses or is disconnected.
   */
  set matchMode(value) {
    void this.setMatchMode(value).mapErr(() => {
      // Preserve the legacy fire-and-forget contract: callers who
      // need rejection handling should migrate to setMatchMode().
    });
  }

  /**
   * Update the match mode and resolve only after the device
   * acknowledges the command. Resolves to an error result when the
   * device NACKs, the request times out, or no connection is open.
   */
  setMatchMode(mode: MatchMode): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const reply = await this.connection?.setMatchMode(mode);
        if (reply === undefined) return err(new VexNotConnectedError());
        if (reply.isErr()) return err(reply.error);
        this.state.matchMode = mode;
        return ok(undefined);
      })(),
    );
  }

  get radio(): V5Radio {
    return this._radio;
  }

  mockTouch(
    x: number,
    y: number,
    press: boolean,
  ): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const reply = await this.connection?.mockTouch(x, y, press);
        if (reply === undefined) return err(new VexNotConnectedError());
        if (reply.isErr()) return err(reply.error);
        return ok(undefined);
      })(),
    );
  }

  connect(conn?: V5SerialConnection): ResultAsync<void, VexSerialError> {
    return this.lifecycle.connect(conn);
  }

  disconnect(): Promise<void> {
    return this.lifecycle.disconnect();
  }

  dispose(): Promise<void> {
    return this.lifecycle.dispose();
  }

  reconnect(timeout = 0): ResultAsync<void, VexSerialError> {
    return this.lifecycle.reconnect(timeout);
  }

  protected createConnection(): V5SerialConnection {
    return new V5SerialConnection(this.defaultSerial, {
      maxFileDownloadBytes: this._maxFileDownloadBytes,
    });
  }

  /**
   * Refresh the high-level device snapshot. All required replies are
   * collected before any public state is mutated, so callers never see
   * a half-updated view. A failed or missing reply resolves to an `Ok`
   * of `false` (the previous snapshot is preserved and only the
   * `isAvailable` flag is updated) so transient communication loss does
   * not surface as a hard error result.
   */
  refresh(): ResultAsync<boolean, VexSerialError> {
    return new ResultAsync(this.snapshots.refresh(this.connection));
  }

  /**
   * Start streaming the running user program's standard output, and accept
   * standard input for it. The caller owns the returned session and must
   * `close()` it; disposing the device does not stop the poll loop on its own.
   */
  openTerminal(
    options: V5TerminalOptions = {},
  ): Result<V5UserProgramTerminal, VexSerialError> {
    return openUserProgramTerminal(this.connection, options);
  }
}
