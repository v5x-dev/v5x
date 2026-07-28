import {
  type MatchMode,
  SerialDeviceType,
  type ISmartDeviceInfo,
} from "./vex.js";
import { type V5SerialConnection } from "./v5-serial-connection.js";
import { VexEventTarget } from "./event.js";
import { VexFirmwareVersion } from "./firmware-version.js";
import { VexSerialError } from "./error.js";
import { ResultAsync } from "neverthrow";
import type { V5SerialDevice } from "./device.js";

export interface VexSerialDeviceEvents {
  disconnected: undefined;
  error: unknown;
}

export abstract class VexSerialDevice extends VexEventTarget<VexSerialDeviceEvents> {
  connection: V5SerialConnection | undefined;
  defaultSerial: Serial;

  get isConnected(): boolean {
    return this.connection != null ? this.connection.isConnected : false;
  }

  get deviceType(): SerialDeviceType | undefined {
    return this.isConnected
      ? this.connection?.port?.getInfo().usbProductId
      : undefined;
  }

  constructor(defaultSerial: Serial) {
    super();
    this.defaultSerial = defaultSerial;
  }

  abstract connect(
    conn?: V5SerialConnection,
  ): ResultAsync<void, VexSerialError>;

  abstract disconnect(): Promise<void>;
}

export class V5SerialDeviceState {
  _instance: V5SerialDevice;
  /**
   * Counter used only to pause automatic refresh while a file transfer
   * is in flight. This is not a mutex: serialization of transfer
   * operations lives on the {@link V5SerialConnection} transaction queue.
   */
  private refreshPauseDepth = 0;

  get isRefreshPaused(): boolean {
    return this.refreshPauseDepth > 0;
  }

  /**
   * @deprecated Use {@link isRefreshPaused}. This flag only means that
   * automatic refresh is paused, not that transfer operations are locked.
   */
  get isFileTransferring(): boolean {
    return this.isRefreshPaused;
  }

  /**
   * Increment the refresh-pause depth, run the operation, and decrement
   * the depth again. The actual transfer mutex lives on the connection.
   */
  async withRefreshPaused<T>(operation: () => PromiseLike<T>): Promise<T> {
    this.refreshPauseDepth++;
    try {
      return await operation();
    } finally {
      this.refreshPauseDepth--;
    }
  }

  /**
   * @deprecated Use {@link withRefreshPaused}. This only pauses automatic
   * refresh and does not lock file transfers.
   */
  async withFileTransfer<T>(operation: () => PromiseLike<T>): Promise<T> {
    return this.withRefreshPaused(operation);
  }

  brain = {
    activeProgram: 0,
    battery: {
      batteryPercent: 0,
      isCharging: false,
    },
    button: {
      isPressed: false,
      isDoublePressed: false,
    },
    cpu0Version: VexFirmwareVersion.allZero(),
    cpu1Version: VexFirmwareVersion.allZero(),
    isAvailable: false,
    settings: {
      isScreenReversed: false,
      isWhiteTheme: false,
      usingLanguage: 0,
    },
    systemVersion: VexFirmwareVersion.allZero(),
    uniqueId: 0,
  };

  controllers: [
    { battery: number; isAvailable: boolean; isCharging: boolean | undefined },
    { battery: number; isAvailable: boolean; isCharging: boolean | undefined },
  ] = [
    {
      battery: 0,
      isAvailable: false,
      isCharging: false,
    },
    {
      battery: 0,
      isAvailable: false,
      isCharging: false,
    },
  ];

  devices: Array<ISmartDeviceInfo | undefined> = [];
  isFieldControllerConnected = false;
  matchMode: MatchMode = "disabled";
  radio = {
    channel: 0,
    isAvailable: false,
    isConnected: false,
    isVexNet: false,
    isRadioData: false,
    latency: 0,
    signalQuality: 0,
    signalStrength: 0,
  };

  constructor(instance: V5SerialDevice) {
    this._instance = instance;
  }
}

export * from "./state/brain.js";
export * from "./state/battery.js";
export * from "./state/brain-button.js";
export * from "./state/brain-settings.js";
export * from "./state/controller.js";
export * from "./state/smart-device.js";
export * from "./state/radio.js";
