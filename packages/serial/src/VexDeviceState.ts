import {
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  type ISmartDeviceInfo,
  SmartDeviceType,
  FileVendor,
  type IProgramInfo,
  type IFileHandle,
  type IFileBasicInfo,
  type IFileWriteRequest,
  FileDownloadTarget,
  RadioChannelType,
} from "./Vex.js";
import { type V5SerialConnection } from "./VexConnection.js";
import { VexEventTarget } from "./VexEvent.js";
import { VexFirmwareVersion } from "./VexFirmwareVersion.js";
import { type ProgramIniConfig } from "./VexIniConfig.js";
import {
  FileControlH2DPacket,
  FileControlReplyD2HPacket,
} from "./VexPacketModels.js";
import type { V5SerialDevice } from "./VexDevice.js";
import * as firmware from "./VexFirmware.js";
import * as transfers from "./VexTransfers.js";

export abstract class VexSerialDevice extends VexEventTarget {
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

  abstract connect(conn?: V5SerialConnection): Promise<boolean>;

  abstract disconnect(): Promise<void>;
}

export class V5SerialDeviceState {
  _instance: V5SerialDevice;
  private fileTransferDepth = 0;

  get _isFileTransferring(): boolean {
    return this.fileTransferDepth > 0;
  }

  async withFileTransfer<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    this.fileTransferDepth++;
    try {
      return await operation();
    } finally {
      this.fileTransferDepth--;
    }
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

  controllers = [
    {
      battery: 0,
      isAvailable: false,
      isCharging: false,
    },
    {
      battery: 0,
      isAvailable: false,
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

export class V5Brain {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get isRunningProgram(): boolean {
    return this.activeProgram !== 0;
  }

  get activeProgram(): number {
    return this.state.brain.activeProgram;
  }

  async setActiveProgram(value: SlotNumber | 0): Promise<boolean> {
    if (this.state.brain.activeProgram === value) return true;

    const conn = this.state._instance.connection;
    if (conn == null) return false;

    const result =
      value === 0 ? await conn.stopProgram() : await conn.loadProgram(value);
    if (result == null) return false;

    this.state.brain.activeProgram = value;
    return true;
  }

  get battery(): V5Battery {
    return new V5Battery(this.state);
  }

  get button(): V5BrainButton {
    return new V5BrainButton(this.state);
  }

  get cpu0Version(): VexFirmwareVersion {
    return this.state.brain.cpu0Version;
  }

  get cpu1Version(): VexFirmwareVersion {
    return this.state.brain.cpu1Version;
  }

  get isAvailable(): boolean {
    return this.state.brain.isAvailable;
  }

  get settings(): V5BrainSettings {
    return new V5BrainSettings(this.state);
  }

  get systemVersion(): VexFirmwareVersion {
    return this.state.brain.systemVersion;
  }

  get uniqueId(): number {
    return this.state.brain.uniqueId;
  }

  async getValue(key: string): Promise<string | undefined> {
    return await transfers.getValue(this.state, key);
  }

  async setValue(key: string, value: string): Promise<boolean> {
    return await transfers.setValue(this.state, key, value);
  }

  async listFiles(
    vendor = FileVendor.USER,
  ): Promise<IFileHandle[] | undefined> {
    return await transfers.listFiles(this.state, vendor);
  }

  async listProgram(): Promise<IProgramInfo[] | undefined> {
    return await transfers.listProgram(this.state);
  }

  async readFile(
    request: IFileBasicInfo | string,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array | undefined> {
    return await transfers.readFile(
      this.state,
      request,
      downloadTarget,
      progressCallback,
    );
  }

  async removeFile(
    request: IFileBasicInfo | string,
  ): Promise<boolean | undefined> {
    return await transfers.removeFile(this.state, request);
  }

  async removeAllFiles(): Promise<boolean | undefined> {
    return await transfers.removeAllFiles(this.state);
  }

  async uploadFirmware(
    publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
    usingVersion?: string,
    progressCallback?: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    return await firmware.uploadFirmware(
      this.state,
      publicUrl,
      usingVersion,
      progressCallback,
    );
  }

  async uploadProgram(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    return await transfers.uploadProgram(
      this.state,
      iniConfig,
      binFileBuf,
      coldFileBuf,
      progressCallback,
    );
  }

  async writeFile(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    return await transfers.writeFile(this.state, request, progressCallback);
  }

  /**
   *
   * @param progressCallback Informs the progress of the download.
   * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
   * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
   */
  async captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array | undefined> {
    return await transfers.captureScreen(this.state, progressCallback);
  }
}

export class V5Battery {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get batteryPercent(): number {
    return this.state.brain.battery.batteryPercent;
  }

  get isCharging(): boolean {
    return this.state.brain.battery.isCharging;
  }
}

export class V5BrainButton {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get isPressed(): boolean {
    return this.state.brain.button.isPressed;
  }

  get isDoublePressed(): boolean {
    return this.state.brain.button.isDoublePressed;
  }
}

export class V5BrainSettings {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get isScreenReversed(): boolean {
    return this.state.brain.settings.isScreenReversed;
  }

  get isWhiteTheme(): boolean {
    return this.state.brain.settings.isWhiteTheme;
  }

  get usingLanguage(): number {
    return this.state.brain.settings.usingLanguage;
  }
}

export class V5Controller {
  private readonly state: V5SerialDeviceState;
  private readonly controllerIndex: number;

  constructor(state: V5SerialDeviceState, controllerIndex: number) {
    this.state = state;
    this.controllerIndex = controllerIndex;
  }

  get batteryPercent(): number {
    return this.state.controllers[this.controllerIndex]!.battery;
  }

  get isMasterController(): boolean {
    return this.controllerIndex === 0;
  }

  get isAvailable(): boolean {
    return this.state.controllers[this.controllerIndex]!.isAvailable;
  }

  get isCharging(): boolean | undefined {
    return this.state.controllers[this.controllerIndex]!.isCharging;
  }
}

export class V5SmartDevice {
  private readonly state: V5SerialDeviceState;
  private readonly deviceIndex: number;

  constructor(state: V5SerialDeviceState, index: number) {
    this.state = state;
    this.deviceIndex = index;
  }

  protected getDeviceInfo(): ISmartDeviceInfo | undefined {
    return this.state.devices[this.deviceIndex];
  }

  get isAvailable(): boolean {
    return this.getDeviceInfo() !== undefined;
  }

  get port(): number {
    return this.deviceIndex;
  }

  get type(): SmartDeviceType {
    return this.getDeviceInfo()?.type ?? SmartDeviceType.EMPTY;
  }

  get version(): number {
    return this.getDeviceInfo()?.version ?? 0;
  }
}

export class V5Radio {
  private readonly state: V5SerialDeviceState;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
  }

  get channel(): number {
    return this.state.radio.channel;
  }

  get isAvailable(): boolean {
    return this.state.radio.isAvailable;
  }

  get isConnected(): boolean {
    return this.state.radio.isConnected;
  }

  get isVexNet(): boolean {
    return this.state.radio.isVexNet;
  }

  get isRadioData(): boolean {
    return this.state.radio.isRadioData;
  }

  get latency(): number {
    return this.state.radio.latency;
  }

  async changeChannel(channel: RadioChannelType): Promise<boolean> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new FileControlH2DPacket(1, channel),
    );
    return result instanceof FileControlReplyD2HPacket;
  }
}
