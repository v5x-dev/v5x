import { type MatchMode, SerialDeviceType } from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import {
  V5Brain,
  V5Controller,
  V5Radio,
  V5SerialDeviceState,
  V5SmartDevice,
  VexSerialDevice,
} from "./VexDeviceState";
import { sleepUntil, sleepUntilAsync } from "./VexFirmware";

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
} from "./VexDeviceState";
export {
  sleep,
  sleepUntil,
  sleepUntilAsync,
  downloadFileFromInternet,
  uploadFirmware,
} from "./VexFirmware";

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true;
  autoRefresh = true;
  pauseRefreshOnFileTransfer = true;

  protected _isReconnecting = false;
  private _isDisconnecting = false;
  private _refreshInterval: ReturnType<typeof setInterval>;
  state: V5SerialDeviceState = new V5SerialDeviceState(this);

  constructor(defaultSerial: Serial) {
    super(defaultSerial);

    let isLastRefreshComplete: boolean = true;
    this._refreshInterval = setInterval(() => {
      if (this.autoRefresh && isLastRefreshComplete) {
        if (!this.isConnected) {
          this.state.brain.isAvailable = false;
          return;
        }

        if (
          !this.pauseRefreshOnFileTransfer ||
          !this.state._isFileTransferring
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

  async setMatchMode(value: MatchMode): Promise<boolean> {
    if ((await this.connection?.setMatchMode(value)) == null) return false;
    this.state.matchMode = value;
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
    clearInterval(this._refreshInterval);
    await this.disconnect();
  }

  /**
   * @param timeout defaults to 0. If timeout is 0, then it will attempt to reconnect forever
   * @returns
   */
  async reconnect(timeout: number = 0): Promise<boolean> {
    if (this.isConnected) return true;
    if (timeout < 0) return false;

    const endTime = new Date().getTime() + timeout;

    if (this._isReconnecting) {
      let successBeforeTimeout;
      do {
        successBeforeTimeout = await sleepUntil(
          () => !this._isReconnecting,
          timeout === 0 ? 1000 : timeout,
        );
        // eslint-disable-next-line no-unmodified-loop-condition
      } while (timeout === 0 && !successBeforeTimeout);

      if (this.isConnected) return true;
      if (!successBeforeTimeout) return false;
    }

    this._isReconnecting = true;
    try {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (timeout === 0 || new Date().getTime() < endTime) {
        // console.log("try to reconnect");

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

  private async doAfterConnect(): Promise<void> {
    if (this.connection == null) return;

    //console.log("doAfterConnect");

    this.connection.on("disconnected", (_data) => {
      if (this.autoReconnect && !this._isDisconnecting) void this.reconnect();
    });

    await this.refresh();
  }

  async refresh(): Promise<boolean> {
    const ssPacket = await this.connection?.getSystemStatus();
    if (ssPacket == null) {
      this.state.brain.isAvailable = false;
      return false;
    }

    this.state.brain.cpu0Version = ssPacket.cpu0Version;
    this.state.brain.cpu1Version = ssPacket.cpu1Version;
    this.state.brain.systemVersion = ssPacket.systemVersion;

    const flags2 = ssPacket.sysflags[2]!;
    this.state.controllers[0]!.isCharging = (flags2 & 0b10000000) !== 0;
    this.state.matchMode =
      (flags2 & 0b00100000) !== 0
        ? "disabled"
        : (flags2 & 0b01000000) !== 0
          ? "autonomous"
          : "driver";
    this.state.isFieldControllerConnected = (flags2 & 0b00010000) !== 0;

    const flags4 = ssPacket.sysflags[4]!;
    this.state.brain.settings.usingLanguage = (flags4 & 0b11110000) >> 4;
    this.state.brain.settings.isWhiteTheme = (flags4 & 0b00000100) !== 0;
    this.state.brain.settings.isScreenReversed = (flags4 & 0b00000001) === 0;

    this.state.brain.uniqueId = ssPacket.uniqueId;

    const sfPacket = await this.connection?.getSystemFlags();
    if (sfPacket == null) return false;

    const flags5 = sfPacket.flags; // Math.pow(2, 32 - i);
    this.state.radio.isRadioData = (flags5 & Math.pow(2, 32 - 12)) !== 0;
    this.state.brain.button.isDoublePressed =
      (flags5 & Math.pow(2, 32 - 14)) !== 0;
    this.state.brain.battery.isCharging = (flags5 & Math.pow(2, 32 - 15)) !== 0;
    this.state.brain.button.isPressed = (flags5 & Math.pow(2, 32 - 17)) !== 0;
    this.state.radio.isVexNet = (flags5 & Math.pow(2, 32 - 18)) !== 0;
    this.state.controllers[1]!.isAvailable =
      (flags5 & Math.pow(2, 32 - 19)) !== 0;
    this.state.radio.isConnected = (flags5 & Math.pow(2, 32 - 22)) !== 0;
    this.state.radio.isAvailable = (flags5 & Math.pow(2, 32 - 23)) !== 0;
    this.state.brain.battery.batteryPercent = sfPacket.battery ?? 0;
    this.state.controllers[0]!.isAvailable =
      this.state.radio.isConnected || this.state.controllers[0]!.isCharging;
    this.state.controllers[0]!.battery = sfPacket.controllerBatteryPercent ?? 0;
    this.state.controllers[1]!.battery =
      sfPacket.partnerControllerBatteryPercent ?? 0;
    this.state.brain.activeProgram = sfPacket.currentProgram;
    this.state.brain.isAvailable =
      !this.isV5Controller || this.state.radio.isConnected;

    const rdPacket = await this.connection?.getRadioStatus();
    if (rdPacket == null) return false;

    this.state.radio.channel = rdPacket.channel;
    this.state.radio.latency = rdPacket.timeslot;
    this.state.radio.signalQuality = rdPacket.quality;
    this.state.radio.signalStrength = rdPacket.strength;

    const dsPacket = await this.connection?.getDeviceStatus();
    if (dsPacket == null) return false;

    let missingPorts = this.state.devices
      .map((d) => d?.port)
      .filter((p): p is number => p !== undefined);

    for (let i = 0; i < dsPacket.devices.length; i++) {
      const device = dsPacket.devices[i]!;
      this.state.devices[device.port] = device;

      // remove device port from missing ports
      missingPorts = missingPorts.filter((p) => p !== device.port);
    }

    missingPorts.forEach((port) => {
      this.state.devices[port] = undefined;
    });

    return true;
  }
}
