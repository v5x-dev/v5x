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

/** Encode `[vendor/first byte, options/second byte, 24-byte filename field]`. */
function filePayload(a: number, b: number, fileName: string): Uint8Array {
  const payload = new Uint8Array(26);
  payload[0] = a;
  payload[1] = b;
  payload.set(encodeFixedText(fileName, "Filename", 24), 2);
  return payload;
}

const clamp100 = (value: number | undefined): number | undefined =>
  value !== undefined && value > 100 ? 100 : value;

export class Query1H2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 33;
  static COMMAND_EXTENDED_ID = undefined;
}

export class SystemVersionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 164;
  static COMMAND_EXTENDED_ID = undefined;
}

export class UpdateMatchModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 193;

  constructor(mode: MatchMode, matchClock: number) {
    const bit1 = mode === "autonomous" ? 10 : mode === "driver" ? 8 : 11;
    const payload = new Uint8Array(5);
    payload[0] = bit1 & 15;
    new DataView(payload.buffer).setUint32(1, matchClock, true);
    super(payload);
  }
}

export class GetMatchStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 194;
}

export class GetRadioModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88;
  static COMMAND_EXTENDED_ID = 65;

  constructor(mode: number) {
    super(Uint8Array.of(mode));
  }
}

export class FileControlH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 16;

  constructor(a: number, b: number) {
    super(Uint8Array.of(a, b));
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

    payload[0] = operation;
    payload[1] = target;
    payload[2] = vendor;
    payload[3] = options;
    view.setUint32(4, binary.length, true);
    view.setUint32(8, addr, true);
    view.setUint32(
      12,
      operation === FileInitAction.WRITE
        ? Packet.ENCODER.crcgen.crc32(binary, 0)
        : 0,
      true,
    );

    // files with a gz extension are also type bin
    let ext = /(?:\.([^.]+))?$/.exec(name)?.[1] ?? "";
    if (ext === "gz") ext = "bin";
    payload.set(encodeFixedText(type ?? ext, "File type", 4), 16);

    const timestamp = ((Date.now() / 1000) >>> 0) - PacketEncoder.J2000_EPOCH;
    view.setUint32(20, timestamp, true);

    payload.set(version.toUint8Array(), 24);
    payload.set(encodeFixedText(name, "Filename", 24), 28);

    super(payload);
  }
}

export class ExitFileTransferH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 18;

  constructor(action: FileExitAction) {
    super(Uint8Array.of(action));
  }
}

export class WriteFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 19;

  constructor(addr: number, buf: Uint8Array) {
    const payload = new Uint8Array(4 + buf.length);
    new DataView(payload.buffer).setUint32(0, addr, true);
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
    super(filePayload(vendor, options, fileName));
  }
}

export class GetDirectoryFileCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 22;

  constructor(vendor: FileVendor) {
    super(Uint8Array.of(vendor, 0));
  }
}

export class GetDirectoryEntryH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 23;

  constructor(index: number) {
    super(Uint8Array.of(index, 0));
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
    const fileName =
      typeof fileNameOrSlotNumber === "string"
        ? fileNameOrSlotNumber
        : `___s_${fileNameOrSlotNumber - 1}.bin`;
    super(filePayload(vendor, actionId, fileName));
  }
}

export class GetFileMetadataH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 25;

  constructor(vendor: FileVendor, fileName: string, options: number) {
    super(filePayload(vendor, options, fileName));
  }
}

export class EraseFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 27;

  constructor(vendor: FileVendor, fileName: string) {
    super(filePayload(vendor, 128, fileName));
  }
}

export class GetProgramSlotInfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 28;

  constructor(vendor: FileVendor, fileName: string) {
    super(filePayload(vendor, 0, fileName));
  }
}

export class FileClearUpH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 30;

  constructor(vendor: FileVendor) {
    super(Uint8Array.of(vendor, 0));
  }
}

export class FileFormatH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 31;

  constructor() {
    super(Uint8Array.of(68, 67, 66, 65));
  }
}

export class GetSystemFlagsH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 32;
}

export class GetDeviceStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 33;
}

export class GetSystemStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 34;
}

export class GetFdtStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 35;
}

export class GetLogCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 36;
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
}

export class ScreenCaptureH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 40;

  constructor(e: number) {
    super(Uint8Array.of(e));
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
    super(Uint8Array.of(screen, port));
  }
}

export class ReadKeyValueH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 46;

  constructor(key: string) {
    const payload = new Uint8Array(32);
    payload.set(encodeFixedText(key, "Key", 31), 0);
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
}

export class GetSlot5to8InfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 50;
}

export class FactoryStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 241;
}

export class FactoryEnableH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 255;

  constructor() {
    super(Uint8Array.of(77, 76, 75, 74));
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
    this.modebit = PacketView.fromPacket(this).nextUint8();
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

    const view = PacketView.fromPacket(this);
    const n = this.ackIndex;

    this.rssi = view.nextInt8();
    this.systemStatusBits = view.nextUint16();
    this.radioStatusBits = view.nextUint16();
    this.fieldStatusBits = view.nextUint8();
    this.matchClock = view.nextUint8();
    this.brainBatteryPercent = view.nextUint8();
    this.controllerBatteryPercent = view.nextUint8();
    this.partnerControllerBatteryPercent = view.nextUint8();
    this.pad = view.nextUint8();
    this.buttons = view.nextUint16();
    this.activeProgram = view.nextUint8();
    this.radioType = view.nextUint8();
    this.radioChannel = view.nextUint8();
    this.radioSlot = view.nextUint8();
    this.controllerFlags = view.getUint8(n + 28);
    this.rxSignalQuality = view.getUint8(n + 29);

    const raw = new TextDecoder("UTF-8").decode(
      this.data.slice(n + 18, n + this.payloadSize + 28),
    );
    const end = raw.indexOf("\0");
    this.robotName = end > -1 ? raw.slice(0, end) : raw;
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
    const view = PacketView.fromPacket(this);
    this.windowSize = view.nextUint16();
    this.fileSize = view.nextUint32();
    this.crc32 = view.nextUint32();
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
    const view = PacketView.fromPacket(this);
    this.addr = view.nextUint32();
    this.length = this.payloadSize - 8;
    this.buf = this.data.slice(
      view.position,
      view.position + this.length,
    ).buffer;
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
    this.count = PacketView.fromPacket(this).nextUint16();
  }
}

export class GetDirectoryEntryReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 23;

  file?: IFileEntry;

  constructor(data: DataArray) {
    super(data);
    if (this.payloadSize <= 4) return;

    const view = PacketView.fromPacket(this);
    this.file = {
      index: view.nextUint8(),
      size: view.nextUint32(),
      loadAddress: view.nextUint32(),
      crc32: view.nextUint32(),
      type: view.nextString(4),
      timestamp: view.nextUint32() + PacketEncoder.J2000_EPOCH,
      version: view.nextVersion(),
      filename: view.nextNTBS(32),
    };
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
    if (this.payloadSize <= 4) return;

    const view = PacketView.fromPacket(this);
    view.nextUint8();
    this.file = {
      size: view.nextUint32(),
      loadAddress: view.nextUint32(),
      crc32: view.nextUint32(),
      type: view.nextString(4),
      timestamp: view.nextUint32() + PacketEncoder.J2000_EPOCH,
      version: view.nextVersion(),
    };
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
    const view = PacketView.fromPacket(this);
    this.slot = view.nextUint8();
    this.requestedSlot = view.nextUint8();
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
  radioSearching = false;
  radioQuality?: number;
  controllerBatteryPercent?: number;
  partnerControllerBatteryPercent?: number;
  battery?: number;
  currentProgram = 0;

  constructor(data: DataArray) {
    super(data);

    const view = PacketView.fromPacket(this);
    this.flags = view.nextUint32();
    const hasPartner = (8192 & this.flags) !== 0;
    const hasRadio = (1536 & this.flags) === 1536;

    const byte1 = view.nextUint8();
    const byte2 = view.nextUint8();

    if (this.payloadSize === 11) {
      this.battery = clamp100(8 * (byte1 & 0x0f));
      if ((this.flags & 0x100) !== 0 || hasRadio) {
        this.controllerBatteryPercent = clamp100(8 * ((byte1 >> 4) & 0x0f));
      }
      if (hasRadio) this.radioQuality = clamp100(8 * (byte2 & 0x0f));
      this.radioSearching = (this.flags & 0x600) === 0x200;
      if (hasPartner) {
        this.partnerControllerBatteryPercent = clamp100(
          8 * ((byte2 >> 4) & 0x0f),
        );
      }
      this.currentProgram = view.nextUint8();
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

    const view = PacketView.fromPacket(this);
    this.count = view.nextUint8();
    this.devices = [];
    for (let i = 0; i < this.count; i++) {
      this.devices.push({
        port: view.nextUint8(),
        type: view.nextUint8(),
        status: view.nextUint8(),
        betaversion: view.nextUint8(),
        version: view.nextUint16(),
        bootversion: view.nextUint16(),
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
  nxpVersion = VexFirmwareVersion.allZero();
  touchVersion: VexFirmwareVersion;
  uniqueId = 1234;
  sysflags: number[] = [0, 0, 0, 0, 0, 0, 0];
  eventBrain = false;
  romBootloaderActive = false;
  ramBootloaderActive = false;
  goldenVersion = VexFirmwareVersion.allZero();

  constructor(data: DataArray) {
    super(data);

    const view = PacketView.fromPacket(this);
    view.nextUint8();

    this.systemVersion = view.nextVersion();
    this.cpu0Version = view.nextVersion();
    this.cpu1Version = view.nextVersion();
    this.touchVersion = view.nextVersion(true);

    if (this.payloadSize > 25) {
      this.uniqueId = view.nextUint32();
      this.sysflags = [
        view.nextUint8(),
        view.nextUint8(),
        view.nextUint8(),
        view.nextUint8(),
        view.nextUint8(),
        0,
        view.nextUint8(),
      ];
      const flags6 = this.sysflags[6]!;
      this.eventBrain = (1 & flags6) !== 0;
      this.romBootloaderActive = (2 & flags6) !== 0;
      this.ramBootloaderActive = (4 & flags6) !== 0;

      view.nextUint16();
      this.goldenVersion = view.nextVersion();
    }

    if (this.payloadSize > 37) {
      this.nxpVersion = view.nextVersion();
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

    const view = PacketView.fromPacket(this);
    this.count = view.nextUint8();
    this.status = [];
    for (let i = 0; i < this.count; i++) {
      this.status.push({
        index: view.nextUint8(),
        type: view.nextUint8(),
        status: view.nextUint8(),
        betaversion: view.nextUint8(),
        version: view.nextUint16(),
        bootversion: view.nextUint16(),
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
    const view = PacketView.fromPacket(this);
    view.nextUint8();
    this.count = view.nextUint32();
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

    const view = PacketView.fromPacket(this);
    const size = view.nextUint8();
    this.offset = view.nextUint32();
    this.count = view.nextUint16();
    this.entries = [];

    let j = this.ackIndex + 8;
    for (let i = 0; i < this.count; i++) {
      this.entries.push({
        code: view.getUint8(j),
        type: view.getUint8(j + 1),
        desc: view.getUint8(j + 2),
        spare: view.getUint8(j + 3),
        time: view.getUint32(j + 4, true),
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

    const view = PacketView.fromPacket(this);
    this.device = view.nextUint8();
    this.quality = view.nextUint16();
    this.strength = view.nextInt16();
    this.channel = this.data[this.ackIndex + 6]!;
    this.timeslot = this.data[this.ackIndex + 7]!;
  }
}

export class ScreenCaptureReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 40;
}

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
    this.value = PacketView.fromPacket(this).nextVarNTBS(255);
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

    const view = PacketView.fromPacket(this);
    this.slotFlags = view.nextUint8();
    this.slots = [];

    for (let i = 0; i < 4; i++) {
      if ((this.slotFlags & (1 << (start - 1 + i))) === 0) continue;

      const icon = view.nextUint16();
      const nameLen = view.nextUint8();
      this.slots.push({
        slot: start + i,
        icon,
        name: view.nextString(nameLen),
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
    const view = PacketView.fromPacket(this);
    this.status = view.nextUint8();
    this.percent = view.nextUint8();
  }
}

export class FactoryEnableReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 255;
}
