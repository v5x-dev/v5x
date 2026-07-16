import { type MatchMode, SerialDeviceType } from "./Vex.js";
import {
  DEFAULT_MAX_FILE_DOWNLOAD_BYTES,
  V5SerialConnection,
} from "./VexConnection.js";
import {
  V5Brain,
  V5Controller,
  V5Radio,
  V5SerialDeviceState,
  V5SmartDevice,
  VexSerialDevice,
  type VexSerialDeviceEvents,
} from "./VexDeviceState.js";
import { sleepUntil, sleepUntilAsync } from "./VexFirmware.js";
import {
  VexInvalidArgumentError,
  VexIoError,
  VexNotConnectedError,
  VexSerialError,
  toVexSerialError,
} from "./VexError.js";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { DeviceSnapshotRefresher } from "./DeviceSnapshotRefresher.js";

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
} from "./VexDeviceState.js";
export {
  sleep,
  sleepUntil,
  sleepUntilAsync,
  downloadFileFromInternet,
  uploadFirmware,
} from "./VexFirmware.js";

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

function describePort(port: SerialPort): string | undefined {
  const info = port.getInfo() as SerialPortInfo & {
    path?: unknown;
    id?: unknown;
    serialNumber?: unknown;
  };
  const identifier = info.path ?? info.id ?? info.serialNumber;
  return typeof identifier === "string" ? identifier : undefined;
}

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true;
  pauseRefreshOnFileTransfer = true;

  protected _isReconnecting = false;
  private _isDisconnecting = false;
  private _refreshInterval: RefreshTimer | undefined;
  state: V5SerialDeviceState = new V5SerialDeviceState(this);
  private _disposed = false;
  private _lifecycleGeneration = 0;
  private _disconnectListener:
    | {
        connection: V5SerialConnection;
        listener: () => void;
      }
    | undefined;
  private readonly snapshots = new DeviceSnapshotRefresher(
    this.state,
    () => this._disposed,
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
    this.autoRefresh = autoRefresh;
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
    if (this._refreshInterval !== undefined || this._disposed) return;
    this._refreshInterval = setInterval(() => {
      if (this._disposed) return;
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
    if (this._disposed) {
      return new ResultAsync(Promise.resolve(this._staleLifecycleResult()));
    }
    if (this.isConnected)
      return new ResultAsync(Promise.resolve(ok(undefined)));

    const generation = ++this._lifecycleGeneration;
    return new ResultAsync(this._connect(conn, generation));
  }

  private async _connect(
    conn?: V5SerialConnection,
    generation: number = this._lifecycleGeneration,
  ): Promise<Result<void, VexSerialError>> {
    if (!this._isLifecycleCurrent(generation)) {
      return this._staleLifecycleResult();
    }
    if (this.isConnected) return ok(undefined);

    if (conn != null) {
      if (!conn.isConnected) {
        const opened = await conn.open();
        if (!(await this._guardLifecycle(generation, conn))) {
          return this._staleLifecycleResult();
        }
        if (opened.isErr() || opened.value !== "opened") {
          return err(new VexIoError("failed to open the supplied connection"));
        }
      }
      const q = await conn.query1();
      if (!(await this._guardLifecycle(generation, conn))) {
        return this._staleLifecycleResult();
      }
      if (q.isErr()) {
        await conn.close();
        return err(q.error);
      }
      if (!this._commitConnection(conn, generation)) {
        await conn.close();
        return this._staleLifecycleResult();
      }
    } else {
      let tryIdx = 0;
      let canRequestPort = true;
      const attemptedPorts = new Set<SerialPort>();
      const attemptedPortNames: string[] = [];
      while (true) {
        if (!this._isLifecycleCurrent(generation)) {
          return this._staleLifecycleResult();
        }
        const c = this.createConnection();

        let result = await c.open(tryIdx++, false);
        if (!(await this._guardLifecycle(generation, c))) {
          return this._staleLifecycleResult();
        }
        if (result.isOk() && result.value === "no-port" && canRequestPort) {
          canRequestPort = false;
          result = await c.open(tryIdx, true);
          if (!(await this._guardLifecycle(generation, c))) {
            return this._staleLifecycleResult();
          }
        }
        if (result.isErr()) {
          await c.close();
          return err(result.error);
        }
        if (result.value === "no-port") {
          const attempted = attemptedPortNames.length
            ? `; attempted ${attemptedPortNames.join(", ")}`
            : "";
          return err(
            new VexNotConnectedError(
              `no responsive V5 device was found${attempted}`,
            ),
          );
        }
        if (result.value === "busy") {
          await c.close();
          return err(
            new VexNotConnectedError("the selected V5 serial port is busy"),
          );
        }

        const port = c.port;
        if (port !== undefined && attemptedPorts.has(port)) {
          await c.close();
          const portName = describePort(port);
          return err(
            new VexNotConnectedError(
              portName === undefined
                ? "the selected serial port did not respond as a V5 device"
                : `serial port ${portName} did not respond as a V5 device`,
            ),
          );
        }
        if (port !== undefined) {
          attemptedPorts.add(port);
          const portName = describePort(port);
          if (portName !== undefined) attemptedPortNames.push(portName);
        }

        const q = await c.query1();
        if (!(await this._guardLifecycle(generation, c))) {
          return this._staleLifecycleResult();
        }
        if (q.isErr()) {
          // no response
          await c.close();
          continue;
        }

        if (!this._commitConnection(c, generation)) {
          await c.close();
          return this._staleLifecycleResult();
        }
        break;
      }
    }

    const connection = this.connection;
    if (!this._isLifecycleCurrent(generation) || connection == null) {
      return this._staleLifecycleResult();
    }
    if (!connection.isConnected) return err(new VexNotConnectedError());

    const initialized = await this.doAfterConnect(connection, generation);
    if (initialized.isErr()) return initialized;

    return ok(undefined);
  }

  async disconnect(): Promise<void> {
    this._lifecycleGeneration++;
    this.snapshots.invalidate();
    this._isDisconnecting = true;
    const connection = this.connection;
    this.connection = undefined;
    this._detachDisconnectListener();
    try {
      await connection?.close();
    } finally {
      this._isDisconnecting = false;
    }
  }

  async dispose(): Promise<void> {
    this.autoReconnect = false;
    this.autoRefresh = false;
    this._disposed = true;
    await this.disconnect();
  }

  /**
   * @param timeout defaults to 0. If timeout is 0, then it will attempt to reconnect forever.
   */
  reconnect(timeout: number = 0): ResultAsync<void, VexSerialError> {
    if (this._disposed) {
      return new ResultAsync(Promise.resolve(this._staleLifecycleResult()));
    }
    if (timeout < 0) {
      return new ResultAsync(
        Promise.resolve(
          err(new VexInvalidArgumentError("timeout must be non-negative")),
        ),
      );
    }
    if (this.isConnected)
      return new ResultAsync(Promise.resolve(ok(undefined)));

    const generation = this._isReconnecting
      ? this._lifecycleGeneration
      : ++this._lifecycleGeneration;
    return new ResultAsync(this._reconnect(timeout, generation));
  }

  private async _reconnect(
    timeout: number,
    generation: number = this._lifecycleGeneration,
  ): Promise<Result<void, VexSerialError>> {
    if (!this._isLifecycleCurrent(generation)) {
      return this._staleLifecycleResult();
    }
    if (this.isConnected) return ok(undefined);
    if (timeout < 0) {
      return err(new VexInvalidArgumentError("timeout must be non-negative"));
    }

    const endTime = Date.now() + timeout;

    if (this._isReconnecting) {
      if (timeout === 0) {
        await this.waitForReconnectToFinish();
      } else {
        const waited = await sleepUntil(() => !this._isReconnecting, timeout);
        if (waited.isErr() || !waited.value) {
          return err(new VexNotConnectedError());
        }
      }

      if (!(await this._guardLifecycle(generation))) {
        return this._staleLifecycleResult();
      }
      if (this.isConnected) return ok(undefined);
    }

    this._isReconnecting = true;
    try {
      while (timeout === 0 || Date.now() < endTime) {
        let tryIdx = 0;
        while (true) {
          if (!this._isLifecycleCurrent(generation)) {
            return this._staleLifecycleResult();
          }
          const c = this.createConnection();

          const result = await c.open(tryIdx++, false);
          if (!(await this._guardLifecycle(generation, c))) {
            return this._staleLifecycleResult();
          }

          if (result.isErr()) {
            await c.close();
            return err(result.error);
          }
          if (result.value === "no-port") break;
          if (result.value === "busy") {
            await c.close();
            continue;
          }

          const status = await c.getSystemStatus(200);
          if (!(await this._guardLifecycle(generation, c))) {
            return this._staleLifecycleResult();
          }
          if (status.isErr()) {
            // no response
            await c.close();
            continue;
          }

          if (
            this.brain.uniqueId !== 0 &&
            status.value.uniqueId !== this.brain.uniqueId
          ) {
            // uuid not match
            await c.close();
            continue;
          }

          if (!this._commitConnection(c, generation)) {
            await c.close();
            return this._staleLifecycleResult();
          }
          break;
        }

        if (this.isConnected) break;

        // try again every second or when the number of ports is different
        const getPortCount = async (): Promise<number> =>
          (await this.defaultSerial.getPorts()).length;
        const portsCount = await getPortCount();
        if (!(await this._guardLifecycle(generation))) {
          return this._staleLifecycleResult();
        }
        await sleepUntilAsync(
          async () => (await getPortCount()) !== portsCount,
          1000,
        );
        if (!(await this._guardLifecycle(generation))) {
          return this._staleLifecycleResult();
        }
      }
    } catch (e) {
      return err(toVexSerialError(e));
    } finally {
      this._isReconnecting = false;
    }

    const connection = this.connection;
    if (!this._isLifecycleCurrent(generation) || connection == null) {
      return this._staleLifecycleResult();
    }
    if (!connection.isConnected) return err(new VexNotConnectedError());

    const initialized = await this.doAfterConnect(connection, generation);
    if (initialized.isErr()) return initialized;

    return ok(undefined);
  }

  private async waitForReconnectToFinish(): Promise<void> {
    while (this._isReconnecting) {
      const r = await sleepUntil(() => !this._isReconnecting, 1000);
      if (r.isOk() && r.value) return;
    }
  }

  protected createConnection(): V5SerialConnection {
    return new V5SerialConnection(this.defaultSerial, {
      maxFileDownloadBytes: this._maxFileDownloadBytes,
    });
  }

  private _isLifecycleCurrent(generation: number): boolean {
    return generation === this._lifecycleGeneration && !this._disposed;
  }

  private async _guardLifecycle(
    generation: number,
    candidate?: V5SerialConnection,
  ): Promise<boolean> {
    if (this._isLifecycleCurrent(generation)) return true;
    await candidate?.close();
    return false;
  }

  private _staleLifecycleResult(): Result<void, VexSerialError> {
    return err(new VexNotConnectedError("connection attempt was superseded"));
  }

  private _commitConnection(
    connection: V5SerialConnection,
    generation: number,
  ): boolean {
    if (!this._isLifecycleCurrent(generation)) return false;

    this._detachDisconnectListener();
    this.connection = connection;
    return true;
  }

  private _detachDisconnectListener(): void {
    const subscription = this._disconnectListener;
    this._disconnectListener = undefined;
    subscription?.connection.remove("disconnected", subscription.listener);
  }

  private async doAfterConnect(
    connection: V5SerialConnection,
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    if (
      !this._isLifecycleCurrent(generation) ||
      this.connection !== connection
    ) {
      return this._staleLifecycleResult();
    }

    const listener = () => {
      if (
        this._isDisconnecting ||
        !this._isLifecycleCurrent(generation) ||
        this.connection !== connection
      ) {
        return;
      }
      // A physical disconnect invalidates the in-flight initialization as
      // well as the committed connection. In particular, a refresh that was
      // already waiting for replies must not turn this into a successful
      // connect after the transport has gone away.
      this._lifecycleGeneration++;
      this.snapshots.invalidate();
      this.connection = undefined;
      this._detachDisconnectListener();
      this._emitSafely("disconnected", undefined);
      if (this.autoReconnect && !this._disposed) {
        void this.reconnect().mapErr((error) =>
          this._emitSafely("error", error),
        );
      }
    };
    connection.on("disconnected", listener);
    this._disconnectListener = { connection, listener };

    const refreshed = await this.refresh();
    if (
      !this._isLifecycleCurrent(generation) ||
      this.connection !== connection ||
      !connection.isConnected
    ) {
      return this._staleLifecycleResult();
    }
    if (refreshed.isErr()) {
      await this._discardConnection(connection, generation);
      return err(refreshed.error);
    }
    if (!refreshed.value) {
      await this._discardConnection(connection, generation);
      return err(
        new VexNotConnectedError(
          "initial device refresh did not produce a current snapshot",
        ),
      );
    }

    return ok(undefined);
  }

  private async _discardConnection(
    connection: V5SerialConnection,
    generation: number,
  ): Promise<void> {
    if (
      !this._isLifecycleCurrent(generation) ||
      this.connection !== connection
    ) {
      return;
    }
    this._lifecycleGeneration++;
    this.snapshots.invalidate();
    this.connection = undefined;
    this._detachDisconnectListener();
    await connection.close();
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
}
