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
  VexNotConnectedError,
  VexProtocolError,
  VexSerialError,
} from "./VexError.js";
import { err, ok, ResultAsync } from "neverthrow";
import {
  FileControlH2DPacket,
  FileControlReplyD2HPacket,
} from "./VexPacketModels.js";
import type { V5SerialDevice } from "./VexDevice.js";
import * as firmware from "./VexFirmware.js";
import * as transfers from "./VexTransfers.js";

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

  controllers = [
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

export class V5Brain {
  private readonly state: V5SerialDeviceState;
  private readonly batteryFacade: V5Battery;
  private readonly buttonFacade: V5BrainButton;
  private readonly settingsFacade: V5BrainSettings;

  constructor(state: V5SerialDeviceState) {
    this.state = state;
    this.batteryFacade = new V5Battery(state);
    this.buttonFacade = new V5BrainButton(state);
    this.settingsFacade = new V5BrainSettings(state);
  }

  get isRunningProgram(): boolean {
    return this.activeProgram !== 0;
  }

  get activeProgram(): number {
    return this.state.brain.activeProgram;
  }

  /**
   * @deprecated Setting this property dispatches a fire-and-forget
   * request that cannot be awaited. Use {@link setActiveProgram}
   * instead, which returns a {@link ResultAsync} that resolves to an
   * error result when the device refuses or is disconnected.
   */
  set activeProgram(value) {
    void this.setActiveProgram(value as SlotNumber | 0).mapErr(() => {
      // Preserve the legacy fire-and-forget contract; callers who
      // need rejection handling should migrate to setActiveProgram().
    });
  }

  /**
   * Load a program slot on the brain, or stop the currently running
   * program when called with `0`. Resolves to an error result when the
   * device refuses, the request times out, or no connection is open.
   */
  setActiveProgram(value: SlotNumber | 0): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        if (this.state.brain.activeProgram === value) return ok(undefined);

        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const result =
          value === 0
            ? await conn.stopProgram()
            : await conn.loadProgram(value);
        if (result.isErr()) return err(result.error);

        this.state.brain.activeProgram = value;
        return ok(undefined);
      })(),
    );
  }

  /**
   * Request that the brain start running the program in the given slot.
   * Resolves to an error result when the device refuses, the request
   * times out, or no connection is open.
   */
  runProgram(slot: SlotNumber | string): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const reply = await conn.runProgram(slot);
        if (reply.isErr()) return err(reply.error);

        if (typeof slot === "number") this.state.brain.activeProgram = slot;
        return ok(undefined);
      })(),
    );
  }

  /**
   * Request that the brain stop the currently running program. Resolves
   * to an error result when the device refuses, the request times out,
   * or no connection is open.
   */
  stopProgram(): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null) return err(new VexNotConnectedError());

        const reply = await conn.stopProgram();
        if (reply.isErr()) return err(reply.error);

        this.state.brain.activeProgram = 0;
        return ok(undefined);
      })(),
    );
  }

  get battery(): V5Battery {
    return this.batteryFacade;
  }

  get button(): V5BrainButton {
    return this.buttonFacade;
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
    return this.settingsFacade;
  }

  get systemVersion(): VexFirmwareVersion {
    return this.state.brain.systemVersion;
  }

  get uniqueId(): number {
    return this.state.brain.uniqueId;
  }

  getValue(key: string): ResultAsync<string | undefined, VexSerialError> {
    return transfers.getValue(this.state, key);
  }

  setValue(key: string, value: string): ResultAsync<void, VexSerialError> {
    return transfers.setValue(this.state, key, value);
  }

  listFiles(
    vendor = FileVendor.USER,
  ): ResultAsync<IFileHandle[], VexSerialError> {
    return transfers.listFiles(this.state, vendor);
  }

  listProgram(): ResultAsync<IProgramInfo[], VexSerialError> {
    return transfers.listProgram(this.state);
  }

  readFile(
    request: IFileBasicInfo | string,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return transfers.readFile(
      this.state,
      request,
      downloadTarget,
      progressCallback,
    );
  }

  removeFile(
    request: IFileBasicInfo | string,
  ): ResultAsync<void, VexSerialError> {
    return transfers.removeFile(this.state, request);
  }

  removeAllFiles(): ResultAsync<void, VexSerialError> {
    return transfers.removeAllFiles(this.state);
  }

  uploadFirmware(
    publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
    usingVersion?: string,
    progressCallback?: (state: string, current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return firmware.uploadFirmware(
      this.state,
      publicUrl,
      usingVersion,
      progressCallback,
    );
  }

  uploadProgram(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return transfers.uploadProgram(
      this.state,
      iniConfig,
      binFileBuf,
      coldFileBuf,
      progressCallback,
    );
  }

  writeFile(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<boolean, VexSerialError> {
    return transfers.writeFile(this.state, request, progressCallback);
  }

  /**
   *
   * @param progressCallback Informs the progress of the download.
   * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
   * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
   */
  captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): ResultAsync<Uint8Array, VexSerialError> {
    return transfers.captureScreen(this.state, progressCallback);
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

  changeChannel(channel: RadioChannelType): ResultAsync<void, VexSerialError> {
    return new ResultAsync(
      (async () => {
        const conn = this.state._instance.connection;
        if (conn == null || !conn.isConnected) {
          return err(new VexNotConnectedError());
        }

        const result = await conn.writeDataAsync(
          new FileControlH2DPacket(1, channel),
        );
        return result instanceof FileControlReplyD2HPacket
          ? ok(undefined)
          : err(new VexProtocolError("changeChannel was not acknowledged"));
      })(),
    );
  }
}
