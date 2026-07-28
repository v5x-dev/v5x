import { PacketView } from "../packet-view.js";
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
  type SlotNumber,
} from "../vex.js";
import { VexFirmwareVersion } from "../firmware-version.js";
import { DeviceBoundPacket, HostBoundPacket } from "../packet-base.js";
import { PacketEncoder, encodeFixedText } from "../packet-encoder.js";

/** Encode `[vendor/first byte, options/second byte, 24-byte filename field]`. */
function filePayload(a: number, b: number, fileName: string): Uint8Array {
  const payload = new Uint8Array(26);
  payload[0] = a;
  payload[1] = b;
  payload.set(encodeFixedText(fileName, "Filename", 24), 2);
  return payload;
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
        ? PacketEncoder.getInstance().crcgen.crc32(binary, 0)
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
  buf: Uint8Array;

  constructor(data: DataArray) {
    super(data);
    const view = PacketView.fromPacket(this);
    this.addr = view.nextUint32();
    this.length = this.payloadSize - 8;
    this.buf = this.data.subarray(view.position, view.position + this.length);
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
