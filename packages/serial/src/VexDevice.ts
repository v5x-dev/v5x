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
} from "./VexDeviceState.js";
import { sleepUntil, sleepUntilAsync } from "./VexFirmware.js";
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

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true;
  autoRefresh = true;
  pauseRefreshOnFileTransfer = true;

  protected _isReconnecting = false;
  private _isDisconnecting = false;
  private _refreshInterval: ReturnType<typeof setInterval> | undefined;
  state: V5SerialDeviceState = new V5SerialDeviceState(this);
  private _disposed = false;
  private _refreshGeneration = 0;

  constructor(defaultSerial: Serial) {
    super(defaultSerial);

    let isLastRefreshComplete: boolean = true;
    this._refreshInterval = setInterval(() => {
      if (this._disposed) return;
      if (this.autoRefresh && isLastRefreshComplete) {
        if (!this.isConnected) {
          this.state.brain.isAvailable = false;
          return;
        }

        if (
          !this.pauseRefreshOnFileTransfer ||
          !this.state.isFileTransferring
        ) {
          isLastRefreshComplete = false;
          void this.refresh()
            .catch((error: unknown) => this.emit("error", error))
            .finally(() => (isLastRefreshComplete = true));
        }
      }
    }, 200);
  }

  get isV5Controller(): boolean {
    return this.deviceType === SerialDeviceType.V5_CONTROLLER;
  }

  get brain(): V5Brain {
    return new V5Brain(this.state);
  }

  get controllers(): [V5Controller, V5Controller] {
    return [new V5Controller(this.state, 0), new V5Controller(this.state, 1)];
  }

  get devices(): V5SmartDevice[] {
    const rtn = [];
    for (let i = 1; i <= this.state.devices.length; i++) {
      if (this.state.devices[i] != null)
        rtn.push(new V5SmartDevice(this.state, i));
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
   * instead, which returns a promise that resolves to `false` when
   * the device refuses or is disconnected.
   */
  set matchMode(value) {
    void this.setMatchMode(value).catch(() => {
      // Preserve the legacy fire-and-forget contract: callers who
      // need rejection handling should migrate to setMatchMode().
    });
  }

  /**
   * Update the match mode and resolve only after the device
   * acknowledges the command. Returns `true` when the new value is
   * committed to the observed state. Returns `false` when the device
   * NACKs, the request times out, or no connection is currently open.
   */
  async setMatchMode(mode: MatchMode): Promise<boolean> {
    const reply = await this.connection?.setMatchMode(mode);
    if (reply == null) return false;
    this.state.matchMode = mode;
    return true;
  }

  get radio(): V5Radio {
    return new V5Radio(this.state);
  }

  async mockTouch(x: number, y: number, press: boolean): Promise<boolean> {
    return !((await this.connection?.mockTouch(x, y, press)) == null);
  }

  async connect(conn?: V5SerialConnection): Promise<boolean> {
    if (this.isConnected) return true;

    if (conn != null) {
      if (!conn.isConnected && !(await conn.open())) return false;
      if ((await conn.query1()) === null) {
        await conn.close();
        return false;
      }
      this.connection = conn;
    } else {
      let tryIdx = 0;
      while (true) {
        const c = new V5SerialConnection(this.defaultSerial);

        const result = await c.open(tryIdx++, true);
        if (result === undefined) return false; // no port left
        if (!result) {
          // has been opened
          await c.close();
          continue;
        }

        if ((await c.query1()) === null) {
          // no response
          await c.close();
          continue;
        }

        this.connection = c;
        break;
      }
    }

    if (!this.isConnected) return false;

    await this.doAfterConnect();

    return true;
  }

  async disconnect(): Promise<void> {
    this._isDisconnecting = true;
    const connection = this.connection;
    this.connection = undefined;
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
    if (this._refreshInterval !== undefined) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
    await this.disconnect();
  }

  /**
   * @param timeout defaults to 0. If timeout is 0, then it will attempt to reconnect forever
   * @returns
   */
  async reconnect(timeout: number = 0): Promise<boolean> {
    if (this.isConnected) return true;
    if (timeout < 0) return false;

    const endTime = Date.now() + timeout;

    if (this._isReconnecting) {
      if (timeout === 0) {
        await this.waitForReconnectToFinish();
      } else if (!(await sleepUntil(() => !this._isReconnecting, timeout))) {
        return false;
      }

      if (this.isConnected) return true;
    }

    this._isReconnecting = true;
    try {
      while (timeout === 0 || Date.now() < endTime) {
        let tryIdx = 0;
        while (true) {
          const c = new V5SerialConnection(this.defaultSerial);

          const result = await c.open(tryIdx++, false);

          if (result === undefined) break; // no port left
          if (!result) {
            // has been opened
            await c.close();
            continue;
          }

          const result2 = await c.getSystemStatus(200);
          if (result2 === null) {
            // no response
            await c.close();
            continue;
          }

          if (
            this.brain.uniqueId !== 0 &&
            result2.uniqueId !== this.brain.uniqueId
          ) {
            // uuid not match
            await c.close();
            continue;
          }

          this.connection = c;
          break;
        }

        if (this.isConnected) break;

        // try again every second or when the number of ports is different
        const getPortCount = async (): Promise<number> =>
          (await this.defaultSerial.getPorts()).length;
        const portsCount = await getPortCount();
        await sleepUntilAsync(
          async () => (await getPortCount()) !== portsCount,
          1000,
        );
      }
    } finally {
      this._isReconnecting = false;
    }

    if (!this.isConnected) return false;

    await this.doAfterConnect();

    return true;
  }

  private async waitForReconnectToFinish(): Promise<void> {
    while (this._isReconnecting) {
      if (await sleepUntil(() => !this._isReconnecting, 1000)) return;
    }
  }

  private async doAfterConnect(): Promise<void> {
    if (this.connection == null) return;

    this.connection.on("disconnected", (_data) => {
      if (this.autoReconnect && !this._isDisconnecting) void this.reconnect();
    });

    await this.refresh();
  }

  /**
   * Refresh the high-level device snapshot. All required replies are
   * collected before any public state is mutated, so callers never see
   * a half-updated view. If any required reply fails the previous
   * snapshot is preserved and only the `isAvailable` flag is updated to
   * reflect the loss of communication.
   */
  async refresh(): Promise<boolean> {
    if (this._disposed) return false;

    const generation = ++this._refreshGeneration;
    const conn = this.connection;
    if (conn == null || !conn.isConnected) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return false;
    }

    const ssPacket = await conn.getSystemStatus();
    if (generation !== this._refreshGeneration || this._disposed) return false;
    if (ssPacket == null) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return false;
    }

    const sfPacket = await conn.getSystemFlags();
    if (generation !== this._refreshGeneration || this._disposed) return false;
    if (sfPacket == null) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return false;
    }

    const rdPacket = await conn.getRadioStatus();
    if (generation !== this._refreshGeneration || this._disposed) return false;
    if (rdPacket == null) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return false;
    }

    const dsPacket = await conn.getDeviceStatus();
    if (generation !== this._refreshGeneration || this._disposed) return false;
    if (dsPacket == null) {
      this._applySnapshotIfCurrent(generation, { isAvailable: false });
      return false;
    }

    const snapshot = this._buildSnapshot(
      ssPacket,
      sfPacket,
      rdPacket,
      dsPacket,
    );
    return this._applySnapshotIfCurrent(generation, snapshot);
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
    Object.assign(this.state.brain, snapshot.brain);
    Object.assign(this.state.controllers[0]!, snapshot.controllers[0]);
    Object.assign(this.state.controllers[1]!, snapshot.controllers[1]);
    Object.assign(this.state.radio, snapshot.radio);

    const next: Array<ISmartDeviceInfo | undefined> = [];
    for (const device of snapshot.devices) {
      if (device != null) next[device.port] = device;
    }
    this.state.devices = next;
    return true;
  }
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
