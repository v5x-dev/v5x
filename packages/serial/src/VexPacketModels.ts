import { PacketView } from "./VexPacketView.js";
import {
  type DataArray,
  type FileDownloadTarget,
  type FileExitAction,
  FileInitAction,
  type FileInitOption,
  type FileLoadAction,
  type FileVendor,
  type IFileEntry,
  type IFileMetadata,
  type ISmartDeviceInfo,
  type MatchMode,
  type SlotNumber,
  type SelectDashScreen,
} from "./Vex.js";
import { VexFirmwareVersion } from "./VexFirmwareVersion.js";
import { DeviceBoundPacket, HostBoundPacket, Packet } from "./VexPacketBase.js";
import { PacketEncoder, encodeFixedText } from "./VexPacketEncoder.js";

const textEncoder = new TextEncoder();

export class Query1H2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 33;
  static COMMAND_EXTENDED_ID = undefined;

  constructor() {
    super(undefined);
  }
}

export class SystemVersionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 164;
  static COMMAND_EXTENDED_ID = undefined;

  constructor() {
    super(undefined);
  }
}

export class UpdateMatchModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 193;

  constructor(mode: MatchMode, matchClock: number) {
    let bit1;
    switch (mode) {
      case "autonomous":
        bit1 = 10;
        break;
      case "driver":
        bit1 = 8;
        break;
      case "disabled":
        bit1 = 11;
    }

    const payload = new Uint8Array(5);
    const view = new DataView(payload.buffer);
    payload[0] = (15 & bit1) >>> 0;

    view.setUint32(1, matchClock, true);

    super(payload);
  }
}

export class GetMatchStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 194;

  constructor() {
    super(undefined);
  }
}

export class GetRadioModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 65;

  constructor(mode: number) {
    const payload = new Uint8Array(1);
    payload[0] = mode;

    super(payload);
  }
}

export class FileControlH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 16;

  constructor(a: number, b: number) {
    const payload = new Uint8Array(2);
    payload.set([a, b], 0);

    super(payload);
  }
}

export class InitFileTransferH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 17;

  constructor(
    operation: FileInitAction,
    target: FileDownloadTarget,
    vendor: FileVendor,
    options: FileInitOption,
    binary: Uint8Array,
    addr: number,
    name: string,
    type?: string,
    version: VexFirmwareVersion = new VexFirmwareVersion(1, 0, 0, 0),
  ) {
    const payload = new Uint8Array(52);
    const view = new DataView(payload.buffer);

    view.setUint8(0, operation);
    view.setUint8(1, target);
    view.setUint8(2, vendor);
    view.setUint8(3, options);
    view.setUint32(4, binary.length, true);
    view.setUint32(8, addr, true);
    view.setUint32(
      12,
      operation === FileInitAction.WRITE
        ? Packet.ENCODER.crcgen.crc32(binary, 0)
        : 0,
      true,
    );

    const re = /(?:\.([^.]+))?$/;
    const reResult = re.exec(name);
    let ext = reResult != null ? reResult[1] : undefined;
    ext ??= "";
    // files with gz extension are also type bin
    ext = ext === "gz" ? "bin" : ext;
    payload.set(encodeFixedText(type ?? ext, "File type", 4), 16);

    const timestamp = ((Date.now() / 1000) >>> 0) - PacketEncoder.J2000_EPOCH;
    view.setUint32(20, timestamp, true);

    payload.set(version.toUint8Array(), 24);

    // filename
    const nameEncoded = encodeFixedText(name, "Filename", 23);
    payload.set(nameEncoded, 28);
    view.setUint8(51, 0);

    super(payload);
  }
}

export class ExitFileTransferH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 18;

  constructor(action: FileExitAction) {
    const payload = new Uint8Array(1);
    payload[0] = action;

    super(payload);
  }
}

export class WriteFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 19;

  constructor(addr: number, buf: Uint8Array) {
    const payload = new Uint8Array(4 + buf.length);
    const view = new DataView(payload.buffer);
    view.setUint32(0, addr, true);
    payload.set(buf, 4);

    super(payload);
  }
}

export class ReadFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 20;

  constructor(addr: number, size: number) {
    const payload = new Uint8Array(6);
    const view = new DataView(payload.buffer);
    view.setUint32(0, addr, true);
    view.setUint16(4, size, true);

    super(payload);
  }
}

export class LinkFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 21;

  constructor(vendor: FileVendor, fileName: string, options: number) {
    const str = encodeFixedText(fileName, "Filename", 23);

    const payload = new Uint8Array(26);
    payload.set([vendor, options], 0);
    payload.set(str, 2);

    super(payload);
  }
}

export class GetDirectoryFileCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 22;

  constructor(vendor: FileVendor) {
    const payload = new Uint8Array(2);
    payload.set([vendor, 0], 0);

    super(payload);
  }
}

export class GetDirectoryEntryH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 23;

  constructor(index: number) {
    const payload = new Uint8Array(2);
    payload.set([index, 0], 0);

    super(payload);
  }
}

export class LoadFileActionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 24;

  constructor(
    vendor: FileVendor,
    actionId: FileLoadAction,
    fileNameOrSlotNumber: SlotNumber | string,
  ) {
    let fileName;
    if (typeof fileNameOrSlotNumber === "string") {
      fileName = fileNameOrSlotNumber;
    } else {
      fileName = "___s_" + (fileNameOrSlotNumber - 1) + ".bin";
    }

    const encodedName = encodeFixedText(fileName, "Filename", 23);
    const payload = new Uint8Array(26);
    payload.set([vendor, actionId], 0);
    payload.set(encodedName, 2);

    super(payload);
  }
}

export class GetFileMetadataH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 25;

  constructor(vendor: FileVendor, fileName: string, options: number) {
    const encodedName = encodeFixedText(fileName, "Filename", 23);

    const payload = new Uint8Array(26);
    payload.set([vendor, options], 0);
    payload.set(encodedName, 2);

    super(payload);
  }
}

export class EraseFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 27;

  constructor(vendor: FileVendor, fileName: string) {
    const encodedName = encodeFixedText(fileName, "Filename", 23);

    const payload = new Uint8Array(26);
    payload.set([vendor, 128], 0);
    payload.set(encodedName, 2);

    super(payload);
  }
}

export class GetProgramSlotInfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 28;

  constructor(vendor: FileVendor, fileName: string) {
    const encodedName = encodeFixedText(fileName, "Filename", 23);

    const payload = new Uint8Array(26);
    payload.set([vendor, 0], 0);
    payload.set(encodedName, 2);

    super(payload);
  }
}

export class FileClearUpH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 30;

  constructor(vendor: FileVendor) {
    const payload = new Uint8Array(2);
    payload.set([vendor, 0], 0);

    super(payload);
  }
}

export class FileFormatH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 31;

  constructor() {
    const payload = new Uint8Array(4);
    payload.set([68, 67, 66, 65], 0);

    super(payload);
  }
}

export class GetSystemFlagsH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 32;
}

export class GetDeviceStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 33;

  constructor() {
    super(undefined);
  }
}

export class GetSystemStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 34;

  constructor() {
    super(undefined);
  }
}

export class GetFdtStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 35;

  constructor() {
    super(undefined);
  }
}

export class GetLogCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 36;

  constructor() {
    super(undefined);
  }
}

export class ReadLogPageH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 37;

  constructor(offset: number, count: number) {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(0, offset, true);
    view.setUint32(4, count, true);

    super(payload);
  }
}

export class GetRadioStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 38;

  constructor() {
    super(undefined);
  }
}

export class ScreenCaptureH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 40;

  constructor(e: number) {
    const payload = new Uint8Array(1);
    payload[0] = e;

    super(payload);
  }
}

export class SendDashTouchH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 42;

  constructor(x: number, y: number, press: boolean) {
    const payload = new Uint8Array(6);
    const view = new DataView(payload.buffer);
    view.setUint16(0, x, true);
    view.setUint16(2, y, true);
    view.setUint16(4, press ? 1 : 0, true);

    super(payload);
  }
}

export class SelectDashH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 43;
  constructor(screen: number | SelectDashScreen, port: number) {
    const payload = new Uint8Array(2);
    payload[0] = screen;
    payload[1] = port;

    super(payload);
  }
}

export class ReadKeyValueH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 46;

  constructor(key: string) {
    const encodedKey = encodeFixedText(key, "Key", 31);
    const payload = new Uint8Array(32);
    payload.set(encodedKey, 0);

    super(payload);
  }
}

export class WriteKeyValueH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 47;

  constructor(key: string, value: string) {
    const strk = encodeFixedText(key, "Key", 31);
    const strv = textEncoder.encode(value);
    if (strk.byteLength + strv.byteLength + 20 > 0x7fff) {
      throw new RangeError("Key and value are too large for a protocol packet");
    }

    const payload = new Uint8Array(strk.length + strv.length + 20);
    payload.set(strk, 0);
    payload.set(strv, strk.length + 1);

    super(payload);
  }
}

export class GetSlot1to4InfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 49;

  constructor() {
    super(undefined);
  }
}

export class GetSlot5to8InfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 50;

  constructor() {
    super(undefined);
  }
}

export class FactoryStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 241;
}

export class FactoryEnableH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 255;

  constructor() {
    const payload = new Uint8Array(4);
    payload.set([77, 76, 75, 74], 0);

    super(payload);
  }
}

export class Query1ReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 33;
  static COMMAND_EXTENDED_ID = undefined;
  joystickFlag1: number;
  joystickFlag2: number;
  brainFlag1: number;
  brainFlag2: number;
  bootloadFlag1: number;
  bootloadFlag2: number;

  constructor(data: DataArray) {
    super(data);

    this.joystickFlag1 = this.data[4]!;
    this.joystickFlag2 = this.data[5]!;
    this.brainFlag1 = this.data[6]!; // a.k.a vex version
    this.brainFlag2 = this.data[7]!;
    this.bootloadFlag1 = this.data[10]!;
    this.bootloadFlag2 = this.data[11]!;
  }
}

export class SystemVersionReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 164;
  static COMMAND_EXTENDED_ID = undefined;
  version: VexFirmwareVersion;
  hardware: number;

  constructor(data: DataArray) {
    super(data);

    this.version = new VexFirmwareVersion(
      this.data[4]!,
      this.data[5]!,
      this.data[6]!,
      this.data[8]!,
    );
    this.hardware = this.data[7]!;
  }
}

export class MatchModeReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 193;

  modebit: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.modebit = dataView.nextUint8();
  }
}

export class MatchStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 194;

  rssi: number; // a.k.a Signal Strength
  systemStatusBits: number;
  radioStatusBits: number; // a.k.a Data Quality
  fieldStatusBits: number;
  matchClock: number;
  brainBatteryPercent: number;
  controllerBatteryPercent: number;
  partnerControllerBatteryPercent: number;
  pad: number;
  buttons: number;
  activeProgram: number;
  radioType: number;
  radioChannel: number;
  radioSlot: number;
  robotName: string;
  controllerFlags: number;
  rxSignalQuality: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);
    const n = this.ackIndex;

    this.rssi = dataView.nextInt8();
    this.systemStatusBits = dataView.nextUint16();
    this.radioStatusBits = dataView.nextUint16();
    this.fieldStatusBits = dataView.nextUint8();
    this.matchClock = dataView.nextUint8();
    this.brainBatteryPercent = dataView.nextUint8();
    this.controllerBatteryPercent = dataView.nextUint8();
    this.partnerControllerBatteryPercent = dataView.nextUint8();
    this.pad = dataView.nextUint8();
    this.buttons = dataView.nextUint16();
    this.activeProgram = dataView.nextUint8();
    this.radioType = dataView.nextUint8();
    this.radioChannel = dataView.nextUint8();
    this.radioSlot = dataView.nextUint8();
    this.robotName = dataView.nextNTBS(10);
    this.controllerFlags = dataView.getUint8(n + 28);
    this.rxSignalQuality = dataView.getUint8(n + 29);

    let rawStr = new TextDecoder("UTF-8").decode(
      data.slice(n + 18, n + this.payloadSize + 28),
    );
    const endIdx = rawStr.indexOf("\0");
    if (endIdx > -1) {
      rawStr = rawStr.substr(0, endIdx);
    }
    this.robotName = rawStr;
  }
}

export class FileControlReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 16;
}

export class InitFileTransferReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 17;
  windowSize: number;
  fileSize: number;
  crc32: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.windowSize = dataView.nextUint16();
    this.fileSize = dataView.nextUint32();
    this.crc32 = dataView.nextUint32();
  }
}

export class ExitFileTransferReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 18;
}

export class WriteFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 19;
}

export class ReadFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 20;
  addr: number;
  length: number;
  buf: ArrayBuffer;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.addr = dataView.nextUint32();
    this.length = this.payloadSize - 8;
    this.buf = this.data.slice(
      dataView.position,
      dataView.position + this.length,
    ).buffer;
  }

  static isValidPacket(data: Uint8Array, n: number): boolean {
    return super.isValidPacket(data, n);
  }
}

export class LinkFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 21;
}

export class GetDirectoryFileCountReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 22;
  count: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.count = dataView.nextUint16();
  }
}

export class GetDirectoryEntryReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 23;

  file?: IFileEntry;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    if (this.payloadSize > 4) {
      this.file = {
        index: dataView.nextUint8(),
        size: dataView.nextUint32(),
        loadAddress: dataView.nextUint32(),
        crc32: dataView.nextUint32(),
        type: dataView.nextString(4),
        timestamp: dataView.nextUint32() + PacketEncoder.J2000_EPOCH,
        version: dataView.nextVersion(),
        filename: dataView.nextNTBS(32),
      };
    }
  }
}

export class LoadFileActionReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 24;
}

export class GetFileMetadataReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 25;

  file?: IFileMetadata;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);
    dataView.nextUint8();

    if (this.payloadSize > 4) {
      this.file = {
        size: dataView.nextUint32(),
        loadAddress: dataView.nextUint32(),
        crc32: dataView.nextUint32(),
        type: dataView.nextString(4),
        timestamp: dataView.nextUint32() + PacketEncoder.J2000_EPOCH,
        version: dataView.nextVersion(),
      };
    }
  }
}

export class EraseFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 27;
}

export class GetProgramSlotInfoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 28;
  requestedSlot: number;
  slot: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.slot = dataView.nextUint8();
    this.requestedSlot = dataView.nextUint8();
  }
}

export class FileClearUpReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 30;
}

export class FileFormatReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 31;
}

export class GetSystemFlagsReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 32;
  flags: number;
  radioSearching: boolean;
  radioQuality?: number;
  controllerBatteryPercent?: number;
  partnerControllerBatteryPercent?: number;
  battery?: number;
  currentProgram: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.radioSearching = false;
    this.currentProgram = 0;

    this.flags = dataView.nextUint32();
    const hasPartner = (8192 & this.flags) !== 0;
    const hasRadio = (1536 & this.flags) === 1536;

    const byte1 = dataView.nextUint8();
    const byte2 = dataView.nextUint8();

    if (this.payloadSize === 11) {
      this.battery = 8 * (byte1 & 0x0f);
      if ((this.flags & 0x100) !== 0 || hasRadio)
        this.controllerBatteryPercent = 8 * ((byte1 >> 4) & 0x0f);
      if (hasRadio) this.radioQuality = 8 * (byte2 & 0x0f);
      this.radioSearching = (this.flags & 0x600) === 0x200;
      if (hasPartner)
        this.partnerControllerBatteryPercent = 8 * ((byte2 >> 4) & 0x0f);
      this.currentProgram = dataView.nextUint8();

      if (this.battery != null && this.battery > 100) this.battery = 100;
      if (
        this.controllerBatteryPercent != null &&
        this.controllerBatteryPercent > 100
      )
        this.controllerBatteryPercent = 100;
      if (this.radioQuality != null && this.radioQuality > 100)
        this.radioQuality = 100;
      if (
        this.partnerControllerBatteryPercent != null &&
        this.partnerControllerBatteryPercent > 100
      )
        this.partnerControllerBatteryPercent = 100;
    }
  }
}

export class GetDeviceStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 33;
  count: number;
  devices: ISmartDeviceInfo[];

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.count = dataView.nextUint8();
    this.devices = [];
    for (let i = 0; i < this.count; i++) {
      this.devices.push({
        port: dataView.nextUint8(),
        type: dataView.nextUint8(),
        status: dataView.nextUint8(),
        betaversion: dataView.nextUint8(),
        version: dataView.nextUint16(),
        bootversion: dataView.nextUint16(),
      });
    }
  }
}

export class GetSystemStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 34;

  systemVersion: VexFirmwareVersion;
  cpu0Version: VexFirmwareVersion;
  cpu1Version: VexFirmwareVersion;
  nxpVersion: VexFirmwareVersion;
  touchVersion: VexFirmwareVersion;
  uniqueId: number;
  sysflags: number[];
  eventBrain: boolean;
  romBootloaderActive: boolean;
  ramBootloaderActive: boolean;
  goldenVersion: VexFirmwareVersion;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    dataView.nextUint8();

    this.systemVersion = dataView.nextVersion();
    this.cpu0Version = dataView.nextVersion();
    this.cpu1Version = dataView.nextVersion();
    this.touchVersion = dataView.nextVersion(true);

    this.uniqueId = 1234;
    this.sysflags = [0, 0, 0, 0, 0, 0, 0];
    this.goldenVersion = VexFirmwareVersion.allZero();
    this.nxpVersion = VexFirmwareVersion.allZero();
    this.eventBrain = false;
    this.romBootloaderActive = false;
    this.ramBootloaderActive = false;

    if (this.payloadSize > 25) {
      this.uniqueId = dataView.nextUint32();
      this.sysflags = [
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        0,
        dataView.nextUint8(),
      ];
      this.eventBrain = (1 & this.sysflags[6]!) !== 0;
      this.romBootloaderActive = (2 & this.sysflags[6]!) !== 0;
      this.ramBootloaderActive = (4 & this.sysflags[6]!) !== 0;

      dataView.nextUint16();

      this.goldenVersion = dataView.nextVersion();
    }

    if (this.payloadSize > 37) {
      this.nxpVersion = dataView.nextVersion();
    }
  }
}

export class GetFdtStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 35;
  count: number;
  status: unknown[];

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.count = dataView.nextUint8();
    this.status = [];
    for (let i = 0; i < this.count; i++) {
      this.status.push({
        index: dataView.nextUint8(),
        type: dataView.nextUint8(),
        status: dataView.nextUint8(),
        betaversion: dataView.nextUint8(),
        version: dataView.nextUint16(),
        bootversion: dataView.nextUint16(),
      });
    }
  }
}

export class GetLogCountReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 36;
  count: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    dataView.nextUint8();

    this.count = dataView.nextUint32();
  }
}

export class ReadLogPageReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 37;
  offset: number;
  count: number;
  entries: unknown[];

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);
    const n = this.ackIndex;

    const size = dataView.nextUint8();
    this.offset = dataView.nextUint32();
    this.count = dataView.nextUint16();
    this.entries = [];

    let j = n + 8;
    for (let i = 0; i < this.count; i++) {
      this.entries.push({
        code: dataView.getUint8(j),
        type: dataView.getUint8(j + 1),
        desc: dataView.getUint8(j + 2),
        spare: dataView.getUint8(j + 3),
        time: dataView.getUint32(j + 4, true),
      });
      j += size;
    }
  }
}

export class GetRadioStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 38;
  device: number; // unsure
  quality: number;
  strength: number;
  channel: number;
  timeslot: number; // time delay?

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);
    const n = this.ackIndex;

    this.device = dataView.nextUint8();
    this.quality = dataView.nextUint16();
    this.strength = dataView.nextInt16();
    this.channel = this.data[n + 6]!;
    this.timeslot = this.data[n + 7]!;
  }
}

export class ScreenCaptureReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 40;
}

// export class UserProgramControlReplyD2HPacket extends HostBoundPacket {
//     static COMMAND_ID = 86;
//     static COMMAND_EXTENDED_ID = 41;
// }

export class SendDashTouchReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 42;
}

export class SelectDashReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 43;
}

export class ReadKeyValueReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 46;
  value: string;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.value = dataView.nextVarNTBS(255);
  }
}

export class WriteKeyValueReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 47;
}

export class GetSlot1to4InfoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 49;
  slotFlags: number;
  slots: unknown[];

  constructor(data: DataArray, start: number = 1) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.slotFlags = dataView.nextUint8();
    this.slots = [];

    for (let i = 0; i < 4; i++) {
      const hasData = (this.slotFlags & Math.pow(2, start - 1 + i)) !== 0;

      if (!hasData) continue;

      const iconNum = dataView.nextUint16();
      const nameLen = dataView.nextUint8();
      const name = dataView.nextString(nameLen);

      this.slots.push({
        slot: start + i,
        icon: iconNum,
        name,
      });
    }
  }
}

export class GetSlot5to8InfoReplyD2HPacket extends GetSlot1to4InfoReplyD2HPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 50;
  slotStartIndex = 5;

  constructor(data: DataArray) {
    super(data, 5);
  }
}

export class FactoryStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 241;
  status: number;
  percent: number;

  constructor(data: DataArray) {
    super(data);

    const dataView = PacketView.fromPacket(this);

    this.status = dataView.nextUint8();
    this.percent = dataView.nextUint8();
  }
}

export class FactoryEnableReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 255;
}
