import {
  type ISmartDeviceInfo,
  type MatchMode,
  SerialDeviceType,
} from "./Vex.js";
import { V5SerialConnection } from "./VexConnection.js";
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
import {
  GetDeviceStatusReplyD2HPacket,
  GetRadioStatusReplyD2HPacket,
  GetSystemFlagsReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
} from "./VexPacket.js";

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
  private _refreshGeneration = 0;
  private _autoRefresh = false;
  private _refreshIntervalMs = 200;
  private _isLastRefreshComplete = true;
  private readonly _brain = new V5Brain(this.state);
  private readonly _controllers: [V5Controller, V5Controller] = [
    new V5Controller(this.state, 0),
    new V5Controller(this.state, 1),
  ];
  private readonly _radio = new V5Radio(this.state);
  private readonly _deviceFacades: Array<V5SmartDevice | undefined> = [];

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
    const rtn: V5SmartDevice[] = [];
    for (let i = 1; i < this.state.devices.length; i++) {
      if (this.state.devices[i] != null) {
        const facade =
          this._deviceFacades[i] ?? new V5SmartDevice(this.state, i);
        this._deviceFacades[i] = facade;
        rtn.push(facade);
      }
    }
    return rtn;
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
        if (!this._isLifecycleCurrent(generation)) {
          await conn.close();
          return this._staleLifecycleResult();
        }
        if (opened.isErr() || opened.value !== "opened") {
          return err(new VexIoError("failed to open the supplied connection"));
        }
      }
      const q = await conn.query1();
      if (!this._isLifecycleCurrent(generation)) {
        await conn.close();
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
        if (!this._isLifecycleCurrent(generation)) {
          await c.close();
          return this._staleLifecycleResult();
        }
        if (result.isOk() && result.value === "no-port" && canRequestPort) {
          canRequestPort = false;
          result = await c.open(tryIdx, true);
          if (!this._isLifecycleCurrent(generation)) {
            await c.close();
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
        if (!this._isLifecycleCurrent(generation)) {
          await c.close();
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
    this._refreshGeneration++;
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

      if (!this._isLifecycleCurrent(generation)) {
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
          if (!this._isLifecycleCurrent(generation)) {
            await c.close();
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
          if (!this._isLifecycleCurrent(generation)) {
            await c.close();
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
        if (!this._isLifecycleCurrent(generation)) {
          return this._staleLifecycleResult();
        }
        await sleepUntilAsync(
          async () => (await getPortCount()) !== portsCount,
          1000,
        );
        if (!this._isLifecycleCurrent(generation)) {
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
    return new V5SerialConnection(this.defaultSerial);
  }

  private _isLifecycleCurrent(generation: number): boolean {
    return generation === this._lifecycleGeneration && !this._disposed;
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
      this._refreshGeneration++;
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
    this._refreshGeneration++;
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
    return new ResultAsync(this._refresh());
  }

  private async _refresh(): Promise<Result<boolean, VexSerialError>> {
    if (this._disposed) return ok(false);

    const generation = ++this._refreshGeneration;
    const conn = this.connection;
    if (conn == null || !conn.isConnected) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return ok(false);
    }

    const [ssPacket, sfPacket, rdPacket, dsPacket] = await Promise.all([
      conn.getSystemStatus(),
      conn.getSystemFlags(),
      conn.getRadioStatus(),
      conn.getDeviceStatus(),
    ]);
    if (generation !== this._refreshGeneration || this._disposed)
      return ok(false);
    if (
      ssPacket.isErr() ||
      sfPacket.isErr() ||
      rdPacket.isErr() ||
      dsPacket.isErr()
    ) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return ok(false);
    }

    const snapshot = this._buildSnapshot(
      ssPacket.value,
      sfPacket.value,
      rdPacket.value,
      dsPacket.value,
    );
    return ok(this._applySnapshotIfCurrent(generation, snapshot));
  }

  private _buildSnapshot(
    ssPacket: GetSystemStatusReplyD2HPacket,
    sfPacket: GetSystemFlagsReplyD2HPacket,
    rdPacket: GetRadioStatusReplyD2HPacket,
    dsPacket: GetDeviceStatusReplyD2HPacket,
  ): V5SerialDeviceSnapshot {
    const flags2 = ssPacket.sysflags[2]!;
    const matchMode: MatchMode =
      (flags2 & 0b00100000) !== 0
        ? "disabled"
        : (flags2 & 0b01000000) !== 0
          ? "autonomous"
          : "driver";
    const isFieldControllerConnected = (flags2 & 0b00010000) !== 0;

    const flags4 = ssPacket.sysflags[4]!;
    const usingLanguage = (flags4 & 0b11110000) >> 4;
    const isWhiteTheme = (flags4 & 0b00000100) !== 0;
    const isScreenReversed = (flags4 & 0b00000001) === 0;

    const flags5 = sfPacket.flags;
    const hasFlag = (bit: number): boolean =>
      (flags5 & (2 ** (32 - bit))) !== 0;
    const isRadioData = hasFlag(12);
    const isDoublePressed = hasFlag(14);
    const isCharging = hasFlag(15);
    const isPressed = hasFlag(17);
    const isVexNet = hasFlag(18);
    const controller1Available = hasFlag(19);
    const radioConnected = hasFlag(22);
    const radioAvailable = hasFlag(23);
    const batteryPercent = sfPacket.battery ?? 0;
    const controller0Available =
      radioConnected || sfPacket.controllerBatteryPercent !== undefined;
    const controller0Battery = sfPacket.controllerBatteryPercent ?? 0;
    const controller1Battery = sfPacket.partnerControllerBatteryPercent ?? 0;
    const activeProgram = sfPacket.currentProgram;
    const isAvailable = !this.isV5Controller || radioConnected;

    const devices = dsPacket.devices.map((d) => ({ ...d }));

    return {
      isAvailable: true,
      matchMode,
      isFieldControllerConnected,
      brain: {
        ...this.state.brain,
        activeProgram,
        battery: { batteryPercent, isCharging },
        button: { isPressed, isDoublePressed },
        cpu0Version: ssPacket.cpu0Version,
        cpu1Version: ssPacket.cpu1Version,
        isAvailable,
        settings: { isScreenReversed, isWhiteTheme, usingLanguage },
        systemVersion: ssPacket.systemVersion,
        uniqueId: ssPacket.uniqueId,
      },
      controllers: [
        {
          battery: controller0Battery,
          isAvailable: controller0Available,
          isCharging: (flags2 & 0b10000000) !== 0,
        },
        {
          battery: controller1Battery,
          isAvailable: controller1Available,
          // The system-status flags expose only the primary controller's
          // charging bit. Do not present it as partner-controller state.
          isCharging: undefined,
        },
      ],
      radio: {
        channel: rdPacket.channel,
        latency: rdPacket.timeslot,
        signalQuality: rdPacket.quality,
        signalStrength: rdPacket.strength,
        isRadioData,
        isVexNet,
        isConnected: radioConnected,
        isAvailable: radioAvailable,
      },
      devices,
    };
  }

  private _applySnapshotIfCurrent(
    generation: number,
    snapshot: V5SerialDeviceSnapshot | { isAvailable: false },
  ): boolean {
    if (this._disposed) return false;
    if (generation !== this._refreshGeneration) return false;

    if (snapshot.isAvailable === false) {
      this.state.brain.isAvailable = false;
      return false;
    }

    this.state.matchMode = snapshot.matchMode;
    this.state.isFieldControllerConnected = snapshot.isFieldControllerConnected;
    const brain = this.state.brain;
    brain.activeProgram = snapshot.brain.activeProgram;
    brain.battery.batteryPercent = snapshot.brain.battery.batteryPercent;
    brain.battery.isCharging = snapshot.brain.battery.isCharging;
    brain.button.isPressed = snapshot.brain.button.isPressed;
    brain.button.isDoublePressed = snapshot.brain.button.isDoublePressed;
    if (brain.cpu0Version.compare(snapshot.brain.cpu0Version) !== 0) {
      brain.cpu0Version = snapshot.brain.cpu0Version;
    }
    if (brain.cpu1Version.compare(snapshot.brain.cpu1Version) !== 0) {
      brain.cpu1Version = snapshot.brain.cpu1Version;
    }
    brain.isAvailable = snapshot.brain.isAvailable;
    brain.settings.isScreenReversed = snapshot.brain.settings.isScreenReversed;
    brain.settings.isWhiteTheme = snapshot.brain.settings.isWhiteTheme;
    brain.settings.usingLanguage = snapshot.brain.settings.usingLanguage;
    if (brain.systemVersion.compare(snapshot.brain.systemVersion) !== 0) {
      brain.systemVersion = snapshot.brain.systemVersion;
    }
    brain.uniqueId = snapshot.brain.uniqueId;
    Object.assign(this.state.controllers[0]!, snapshot.controllers[0]);
    Object.assign(this.state.controllers[1]!, snapshot.controllers[1]);
    Object.assign(this.state.radio, snapshot.radio);

    const next: Array<ISmartDeviceInfo | undefined> = [];
    for (const device of snapshot.devices) {
      if (device != null) next[device.port] = device;
    }
    if (!sameSmartDeviceSlots(this.state.devices, next)) {
      this.state.devices = next;
    }
    return true;
  }
}

function sameSmartDeviceSlots(
  left: Array<ISmartDeviceInfo | undefined>,
  right: Array<ISmartDeviceInfo | undefined>,
): boolean {
  return (
    left.length === right.length &&
    left.every((device, index) => {
      const next = right[index];
      return (
        device === next ||
        (device !== undefined &&
          next !== undefined &&
          device.port === next.port &&
          device.type === next.type &&
          device.status === next.status &&
          device.betaversion === next.betaversion &&
          device.version === next.version &&
          device.bootversion === next.bootversion)
      );
    })
  );
}

interface V5SerialDeviceSnapshot {
  isAvailable: true;
  matchMode: MatchMode;
  isFieldControllerConnected: boolean;
  brain: V5SerialDeviceState["brain"];
  controllers: V5SerialDeviceState["controllers"];
  radio: V5SerialDeviceState["radio"];
  devices: ISmartDeviceInfo[];
}
