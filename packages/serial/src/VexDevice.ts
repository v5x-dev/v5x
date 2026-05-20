import { unzip } from "unzipit";
import {
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  type ISmartDeviceInfo,
  SmartDeviceType,
  FileVendor,
  type IProgramInfo,
  FileExitAction,
  type IFileHandle,
  FileDownloadTarget,
  USER_FLASH_USR_CODE_START,
  type IFileBasicInfo,
  type IFileWriteRequest,
  RadioChannelType,
} from "./Vex";
import { V5SerialConnection } from "./VexConnection";
import { VexEventTarget } from "./VexEvent";
import { VexFirmwareVersion } from "./VexFirmwareVersion";
import { type ProgramIniConfig } from "./VexIniConfig";
import {
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
  FileControlH2DPacket,
  FileControlReplyD2HPacket,
  GetDirectoryEntryH2DPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountH2DPacket,
  GetDirectoryFileCountReplyD2HPacket,
  GetProgramSlotInfoH2DPacket,
  GetProgramSlotInfoReplyD2HPacket,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  ScreenCaptureH2DPacket,
  WriteKeyValueH2DPacket,
  WriteKeyValueReplyD2HPacket,
} from "./VexPacket";

export async function downloadFileFromInternet(
  link: string,
): Promise<ArrayBuffer> {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const oReq = new XMLHttpRequest();
    oReq.open("GET", link, true);
    oReq.responseType = "arraybuffer";

    oReq.onload = function (_oEvent) {
      const arrayBuffer = oReq.response; // Note: not oReq.responseText
      resolve(arrayBuffer);
    };

    oReq.onerror = function (oEvent) {
      reject(oEvent);
    };

    oReq.send(null);
  });
}
export async function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let lastTime = new Date().getTime();
    let stopped = false;
    const stopper = setTimeout(() => {
      stopped = true;
      resolve(false);
    }, timeout);
    const checker = (val: boolean): void => {
      if (stopped) return;

      if (val) {
        clearTimeout(stopper);
        resolve(true);
      } else if (new Date().getTime() - lastTime > interval) {
        lastTime = new Date().getTime();
        void f().then(checker);
      } else
        setTimeout(() => {
          lastTime = new Date().getTime();
          void f().then(checker);
        }, new Date().getTime() - lastTime);
    };
    void f().then(checker);
  });
}

export async function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timeWas = new Date().getTime();
    const wait = setInterval(function () {
      if (f()) {
        clearInterval(wait);
        resolve(true);
      } else if (new Date().getTime() - timeWas > timeout) {
        // Timeout
        clearInterval(wait);
        resolve(false);
      }
    }, interval);
  });
}

export async function sleep(ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

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

  abstract disconnect(): void;
}

class V5SerialDeviceState {
  _instance: V5SerialDevice;
  _isFileTransferring = false;

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

  set activeProgram(value) {
    void (async () => {
      if (this.state.brain.activeProgram === value) return;

      const conn = this.state._instance.connection;
      if (conn == null) return;

      const fn =
        value === 0
          ? await conn.stopProgram()
          : await conn.loadProgram(value as SlotNumber);

      if (fn != null) this.state.brain.activeProgram = value;
    })();
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
    const result = await this.state._instance.connection?.writeDataAsync(
      new ReadKeyValueH2DPacket(key),
    );
    return result instanceof ReadKeyValueReplyD2HPacket
      ? result.value
      : undefined;
  }

  async setValue(key: string, value: string): Promise<boolean> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new WriteKeyValueH2DPacket(key, value),
    );
    return result instanceof WriteKeyValueReplyD2HPacket;
  }

  async listFiles(
    vendor = FileVendor.USER,
  ): Promise<IFileHandle[] | undefined> {
    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return;

    const result = await conn.writeDataAsync(
      new GetDirectoryFileCountH2DPacket(vendor),
    );
    if (!(result instanceof GetDirectoryFileCountReplyD2HPacket)) return;

    const files: IFileHandle[] = [];
    for (let i = 0; i < result.count; i++) {
      const result2 = await conn.writeDataAsync(
        new GetDirectoryEntryH2DPacket(i),
      );
      if (!(result2 instanceof GetDirectoryEntryReplyD2HPacket)) return;

      // .file is undefined if the file is not found
      // .file is a file entry but not a file handle
      if (result2.file != null) {
        files.push({
          filename: result2.file.filename,
          vendor,
          loadAddress: result2.file.loadAddress,

          size: result2.file.size,
          crc32: result2.file.crc32,

          type: result2.file.type,
          timestamp: result2.file.timestamp,
          version: result2.file.version,
        });
      }
    }

    return files;
  }

  async listProgram(): Promise<IProgramInfo[] | undefined> {
    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return;

    const files = await this.listFiles(FileVendor.USER);
    if (files === undefined) return;

    const programList: IProgramInfo[] = [];
    const iniFiles = files.filter(
      (file) => file?.filename.search(/.ini$/) > 0 ?? false,
    );

    for (let i = 0; i < iniFiles.length; i++) {
      const ini = iniFiles[i];
      if (ini.size === 0) continue;

      const programName = /(.+?)(\.[^.]*$|$)/.exec(ini.filename)?.[1] ?? "";
      const bin = files.filter(
        (e) => e != null && e.filename === programName + ".bin",
      )[0];
      if (bin == null || bin.timestamp === 0 || bin.size === 0) continue;

      const n = new Date();
      n.setTime(1000 * bin.timestamp);
      const program: IProgramInfo = {
        name: programName,
        binfile: bin.filename,
        size: ini.size + bin.size,
        slot: -1,
        time: n,
        requestedSlot: -1,
      };

      const result2 = await conn?.writeDataAsync(
        new GetProgramSlotInfoH2DPacket(FileVendor.USER, program.binfile),
      );
      if (result2 instanceof GetProgramSlotInfoReplyD2HPacket) {
        program.slot = result2.slot;
        program.requestedSlot = result2.requestedSlot;
      }
      programList.push(program);
    }
    return programList;
  }

  async readFile(
    request: IFileBasicInfo | string,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array | undefined> {
    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return;

    this.state._isFileTransferring = true;

    let handle: IFileBasicInfo;

    // If request is a string, then it is a filename
    if (typeof request === "string") {
      handle = { filename: request, vendor: FileVendor.USER };
    } else {
      handle = request;
    }

    try {
      return await conn.downloadFileToHost(
        handle,
        downloadTarget,
        progressCallback,
      );
    } catch (e) {
      this.state._isFileTransferring = false;
      throw e;
    }
  }

  async removeFile(
    request: IFileBasicInfo | string,
  ): Promise<boolean | undefined> {
    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return;

    let vendor: FileVendor, filename: string;

    // If request is a string, then it is a filename
    if (typeof request === "string") {
      vendor = FileVendor.USER;
      filename = request;
    } else {
      vendor = request.vendor;
      filename = request.filename;
    }

    const result = await conn.writeDataAsync(
      new EraseFileH2DPacket(vendor, filename),
    );
    const result2 = await conn.writeDataAsync(
      new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
    );

    if (!(result instanceof EraseFileReplyD2HPacket)) return false;
    if (!(result2 instanceof ExitFileTransferReplyD2HPacket)) return false;

    return true;
  }

  async removeAllFiles(): Promise<boolean | undefined> {
    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return undefined;

    const result = await conn.writeDataAsync(
      new FileClearUpH2DPacket(FileVendor.USER),
      30000,
    );
    return result instanceof FileClearUpReplyD2HPacket;
  }

  async uploadFirmware(
    publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
    usingVersion?: string,
    progressCallback?: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    const device = this.state._instance;
    const conn = device.connection;
    if (conn == null || !conn.isConnected) return;

    const pcb = progressCallback ?? (() => {});

    let vexos: ArrayBuffer, bootBin: ArrayBuffer, assertBin: ArrayBuffer;

    try {
      if (usingVersion === undefined) {
        pcb("FETCH CATALOG", 0, 1);

        const catalog = await downloadFileFromInternet(
          publicUrl + "catalog.txt",
        );
        const latestVersion = new TextDecoder().decode(catalog);
        usingVersion = latestVersion;

        pcb("FETCH CATALOG", 1, 1);

        console.log("fetched catalog.txt", latestVersion);
      }

      pcb("FETCH VEXOS", 0, 1);

      vexos = await downloadFileFromInternet(
        publicUrl + usingVersion + ".vexos",
      );

      pcb("FETCH VEXOS", 1, 1);
      pcb("UNZIP VEXOS", 0, 1);

      const { entries } = await unzip(vexos);

      bootBin = await entries[usingVersion + "/BOOT.bin"].arrayBuffer();
      assertBin = await entries[usingVersion + "/assets.bin"].arrayBuffer();

      pcb("UNZIP VEXOS", 1, 1);
    } catch (e) {
      return undefined;
    }

    try {
      this.state._isFileTransferring = true;

      pcb("FACTORY ENB BOOT", 0, 0);

      const result = await conn.writeDataAsync(new FactoryEnableH2DPacket());
      if (!(result instanceof FactoryEnableReplyD2HPacket)) return false;

      const bootWriteRequest: IFileWriteRequest = {
        filename: "null.bin",
        vendor: FileVendor.USER,
        loadAddress: USER_FLASH_USR_CODE_START,
        buf: new Uint8Array(bootBin),
        downloadTarget: FileDownloadTarget.FILE_TARGET_B1,
        exttype: "bin",
        autoRun: true, // need to set EXIT_RUN
        linkedFile: undefined,
      };

      const result2 = await conn.uploadFileToDevice(
        bootWriteRequest,
        (c, t) => {
          pcb("UPLOAD BOOT", c, t);
        },
      );
      if (!result2) return false;

      while (true) {
        const result3 = await conn.writeDataAsync(
          new FactoryStatusH2DPacket(),
          10000,
        );
        if (result3 instanceof FactoryStatusReplyD2HPacket) {
          switch (result3.status) {
            case 2:
              pcb("ERASE BOOT", result3.percent, 100);
              break;
            case 3:
              pcb("WRITE BOOT", result3.percent, 100);
              break;
            case 4:
              pcb("VERIFY BOOT", result3.percent, 100);
              break;
            case 8:
              pcb("FINISHING BOOT", result3.percent, 100);
              break;
          }
          if (result3.status === 0 && result3.percent === 100) break;
        } else {
          return false;
        }
        await sleep(500);
      }

      pcb("FACTORY ENB ASSERT", 0, 0);

      const result5 = await conn.writeDataAsync(new FactoryEnableH2DPacket());
      if (!(result5 instanceof FactoryEnableReplyD2HPacket)) return false;

      const assertWriteRequest: IFileWriteRequest = {
        filename: "null.bin",
        vendor: FileVendor.USER,
        loadAddress: USER_FLASH_USR_CODE_START,
        buf: new Uint8Array(assertBin),
        downloadTarget: FileDownloadTarget.FILE_TARGET_A1,
        exttype: "bin",
        autoRun: true, // need to set EXIT_RUN
        linkedFile: undefined,
      };

      const result6 = await conn.uploadFileToDevice(
        assertWriteRequest,
        (c, t) => {
          pcb("UPLOAD ASSERT", c, t);
        },
      );
      if (!result6) return false;

      while (true) {
        const result7 = await conn.writeDataAsync(
          new FactoryStatusH2DPacket(),
          10000,
        );
        if (result7 instanceof FactoryStatusReplyD2HPacket) {
          switch (result7.status) {
            case 2:
              pcb("ERASE ASSERT", result7.percent, 100);
              break;
            case 3:
              pcb("WRITE ASSERT", result7.percent, 100);
              break;
            case 4:
              pcb("VERIFY ASSERT", result7.percent, 100);
              break;
            case 8:
              pcb("FINISHING ASSERT", result7.percent, 100);
              break;
          }

          if (result7.status === 0 && result7.percent === 100) break;
        } else {
          return false;
        }
        await sleep(500);
      }
    } catch (e) {
      this.state._isFileTransferring = false;
      throw e;
    }

    return true;
  }

  async uploadProgram(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    const device = this.state._instance;
    const conn = device.connection;
    if (conn == null || !conn.isConnected) return;

    this.state._isFileTransferring = true;

    try {
      if (device.isV5Controller) {
        await sleep(250);

        // V5 Controller doesn\'t appear to be connected to a V5 Brain
        if (!(await device.refresh())) return;

        console.log("Transferring to download channel");

        const p1 = await device.radio.changeChannel(RadioChannelType.DOWNLOAD);
        if (!p1) return false;

        await sleep(250);
        await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200,
        );

        console.log("Transferred to download channel");
      }

      const p2 = await conn.uploadProgramToDevice(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback,
      );
      if (!(p2 ?? false)) return false;

      if (device.isV5Controller) {
        // Disconnected
        if (!device.brain.isAvailable) return false;

        console.log("Transferring back to pit channel");

        const p3 = await device.radio.changeChannel(RadioChannelType.PIT);
        if (!p3) return false;

        await sleep(250);
        await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200,
        );

        console.log("All done");
      }

      return true;
    } catch (e) {
      this.state._isFileTransferring = false;
      throw e;
    }
  }

  async writeFile(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    this.state._isFileTransferring = true;

    const conn = this.state._instance.connection;
    if (conn == null || !conn.isConnected) return undefined;

    try {
      return await conn.uploadFileToDevice(request, progressCallback);
    } catch (e) {
      this.state._isFileTransferring = false;
      throw e;
    }
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
    // pros implementation: https://github.com/purduesigbots/pros-cli/blob/5ee18656faeb48f51d680bab4b53d5b59cc5a7d5/pros/serial/devices/vex/v5_device.py#L578

    const conn = this.state._instance.connection;

    if (conn == null || !conn.isConnected) return undefined;
    await new Promise((resolve) => {
      conn.writeData(new ScreenCaptureH2DPacket(0), resolve);
    });

    const height = 272;
    const width = 480;
    const channels = 3;
    const messageWidth = 512; // brain goofiness
    const messageChannels = 4; // brain goofiness

    let buf = await conn?.downloadFileToHost(
      {
        filename: "screen",
        vendor: FileVendor.SYS,
        loadAddress: 0,
        size: messageWidth * height * messageChannels, // RGBA ig
      },
      FileDownloadTarget.FILE_TARGET_CBUF,
      progressCallback,
    );
    if (buf == null) return;

    buf = buf
      // remove the extra columns
      .filter(
        (_byte, i) =>
          i % (messageWidth * messageChannels) < width * messageChannels,
      )
      // remove the fake alpha channel
      .filter((_byte, i) => (i + 1) % messageChannels !== 0);

    // reverse the pixel (bgr -> rgb)
    for (let i = 0; i < buf.length; i += channels) {
      const px = buf.slice(i, i + channels).reverse();
      for (let j = 0; j < px.length; j++) {
        buf[i + j] = px[j];
      }
    }

    return buf;
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
    return this.state.controllers[this.controllerIndex].battery;
  }

  get isMasterController(): boolean {
    return this.controllerIndex === 0;
  }

  get isAvailable(): boolean {
    return this.state.controllers[this.controllerIndex].isAvailable;
  }

  get isCharging(): boolean | undefined {
    return this.state.controllers[this.controllerIndex].isCharging;
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

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true;
  autoRefresh = true;
  pauseRefreshOnFileTransfer = true;

  protected _isReconnecting = false;
  state: V5SerialDeviceState = new V5SerialDeviceState(this);

  constructor(defaultSerial: Serial) {
    super(defaultSerial);

    let isLastRefreshComplete: boolean = true;
    setInterval(() => {
      if (this.autoRefresh && isLastRefreshComplete) {
        if (!this.isConnected) {
          this.state.brain.isAvailable = false;
          return;
        }

        if (
          this.pauseRefreshOnFileTransfer &&
          !this.state._isFileTransferring
        ) {
          isLastRefreshComplete = false;
          void this.refresh().finally(() => (isLastRefreshComplete = true));
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

  set matchMode(value) {
    void (async () => {
      if ((await this.connection?.setMatchMode(value)) != null)
        this.state.matchMode = value;
    })();
  }

  get radio(): V5Radio {
    return new V5Radio(this.state);
  }

  async mockTouch(x: number, y: number, press: boolean): Promise<boolean> {
    return !((await this.connection?.mockTouch(x, y, press)) == null);
  }

  async connect(conn?: V5SerialConnection): Promise<boolean> {
    if (this.isConnected) return true;

    if (conn != null && !conn.isConnected) {
      if ((await conn.query1()) === null) return false;

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
    await this.connection?.close();
    this.connection = undefined;
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

    this._isReconnecting = false;

    if (!this.isConnected) return false;

    void this.doAfterConnect();

    return true;
  }

  private async doAfterConnect(): Promise<void> {
    if (this.connection == null) return;

    console.log("doAfterConnect");

    this.connection.on("disconnected", (_data) => {
      if (this.autoReconnect) void this.reconnect();
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

    const flags2 = ssPacket.sysflags[2];
    this.state.controllers[0].isCharging = (flags2 & 0b10000000) !== 0;
    this.state.matchMode =
      (flags2 & 0b00100000) !== 0
        ? "disabled"
        : (flags2 & 0b01000000) !== 0
          ? "autonomous"
          : "driver";
    this.state.isFieldControllerConnected = (flags2 & 0b00010000) !== 0;

    const flags4 = ssPacket.sysflags[4];
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
    this.state.controllers[1].isAvailable =
      (flags5 & Math.pow(2, 32 - 19)) !== 0;
    this.state.radio.isConnected = (flags5 & Math.pow(2, 32 - 22)) !== 0;
    this.state.radio.isAvailable = (flags5 & Math.pow(2, 32 - 23)) !== 0;
    this.state.brain.battery.batteryPercent = sfPacket.battery ?? 0;
    this.state.controllers[0].isAvailable =
      this.state.radio.isConnected || this.state.controllers[0].isCharging;
    this.state.controllers[0].battery = sfPacket.controllerBatteryPercent ?? 0;
    this.state.controllers[1].battery =
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
      const device = dsPacket.devices[i];
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
