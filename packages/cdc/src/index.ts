export const COMMAND_HEADER = Uint8Array.of(0xc9, 0x36, 0xb8, 0x47);
export const REPLY_HEADER = Uint8Array.of(0xaa, 0x55);

export const cmds = {
  QUERY_1: 0x21,
  ACK: 0x33,
  BRAIN_NAME_GET: 0x44,
  USER_CDC: 0x56,
  CON_CDC: 0x58,
  USER_ENTER: 0x60,
  USER_CATALOG: 0x61,
  FLASH_ERASE: 0x63,
  FLASH_WRITE: 0x64,
  FLASH_READ: 0x65,
  USER_EXIT: 0x66,
  USER_PLAY: 0x67,
  USER_STOP: 0x68,
  COMPONENT_GET: 0x69,
  USER_SLOT_GET: 0x78,
  USER_SLOT_SET: 0x79,
  SYSTEM_VERSION: 0xa4,
  LCD_READ: 0x73,
  LCD_SAVE: 0x75,
  ALERT_STATUS: 0x82,
  CON_RADIO_RESET: 0x90,
  CON_BACKLIGHT: 0x44,
  CON_RUMBLE: 0x47,
  CON_DASHBOARD_VIEW: 0x50,
  PARTNER_CON_CDC: 0x59,
  CON_PUPPET_INPUT: 0x60,
  CON_RADIO_PORT_RX: 0x91,
  CON_RADIO_TYPE: 0x92,
  CON_RADIO_CONFIGURE: 0x9b,
  CON_RADIO_PORT_TX: 0xb0,
  CON_RADIO_PATCH_FW_BUF: 0xb2,
  CON_RADIO_FULL_FW_BUF: 0xb3,
} as const;

export const ecmds = {
  FT_COMPLETE: 0x00,
  FT_INIT: 0x11,
  FT_ERASE: 0x12,
  FT_WRITE: 0x13,
  FT_READ: 0x14,
  FT_SET_LINK: 0x15,
  FT_DIR_ENTRY: 0x16,
  FT_DIR_COUNT: 0x17,
  FT_GET_CRC: 0x18,
  FT_GET_LINK: 0x19,
  FT_SET_METADATA: 0x1a,
  FT_GET_METADATA: 0x1b,
  FT_GET_FILE_SIZE: 0x1c,
  FT_GET_FREE_SPACE: 0x1d,
  FT_GET_VERSION: 0x1e,
  FT_GET_TYPE: 0x1f,
  FT_EXIT: 0x20,
  SCREEN_GRAB: 0x21,
  SCREEN_CAP: 0x22,
  SYS_FLAGS: 0x22,
  SYS_STATUS: 0x23,
  SYS_TIME: 0x24,
  SYS_METADATA: 0x25,
  SYS_BATTERY: 0x26,
  SYS_USB_STATUS: 0x27,
  SYS_RADIO_STATUS: 0x28,
  SYS_USER_FIFO: 0x2d,
  CON_COMP_CTRL: 0x30,
  CON_COMP_GET_SMARTFIELD: 0x31,
  CON_RADIO_CONTYPE: 0x42,
  CON_RADIO_CONFIGURE: 0x9b,
  AI2CAM_STATUS: 0xa0,
  AI2CAM_SETTINGS: 0xa1,
  AI2CAM_MODEL: 0xa2,
  AI2CAM_CLASSNAME: 0xa3,
  AI2CAM_COLOR: 0xa4,
  AI2CAM_COLORSIG: 0xa5,
  AI2CAM_APRILTAG: 0xa6,
  AI2CAM_WIFI: 0xa7,
  FACTORY_STATUS: 0xf0,
  FACTORY_ENABLE: 0xf1,
  FACTORY_DEVICE: 0xf2,
} as const;

export class DecodeError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "UnexpectedEnd"
      | "UnexpectedByte"
      | "Checksum"
      | "InvalidHeader"
      | "UnterminatedString"
      | "Utf8Error" = "UnexpectedEnd",
  ) {
    super(message);
    this.name = "DecodeError";
  }
}

export interface CdcCommand<Reply = unknown> {
  readonly cmd: number;
  encode(): Uint8Array;
  decodeReply?(data: BytesLike): Reply;
}

export type BytesLike = Uint8Array | ArrayBuffer | ArrayBufferView;
export type Encoder = (writer: BinaryWriter) => void;
export type Decoder<T> = (reader: BinaryReader) => T;

export function toUint8Array(data: BytesLike): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export class BinaryWriter {
  private chunks: number[] = [];

  get length(): number {
    return this.chunks.length;
  }

  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    this.u8(value);
    this.u8(value >> 8);
    return this;
  }

  u32(value: number): this {
    this.u8(value);
    this.u8(value >> 8);
    this.u8(value >> 16);
    this.u8(value >> 24);
    return this;
  }

  bytes(data: BytesLike): this {
    this.chunks.push(...toUint8Array(data));
    return this;
  }

  fixedString(value: string, length: number): this {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > length) {
      throw new RangeError(
        `String is ${bytes.length} bytes, expected at most ${length}`,
      );
    }
    this.bytes(bytes);
    for (let i = bytes.length; i < length; i += 1) this.u8(0);
    return this;
  }

  varU16(value: number): this {
    if (value < 0 || value > 0x7fff || !Number.isInteger(value)) {
      throw new RangeError(`VarU16 out of range: ${value}`);
    }
    if (value > 0x7f) {
      this.u8(((value >> 8) & 0x7f) | 0x80);
      this.u8(value & 0xff);
    } else {
      this.u8(value);
    }
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export class BinaryReader {
  readonly data: Uint8Array;
  offset = 0;

  constructor(data: BytesLike) {
    this.data = toUint8Array(data);
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  u8(): number {
    this.require(1);
    return this.data[this.offset++]!;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (
      (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>>
      0
    );
  }

  bytes(length: number): Uint8Array {
    this.require(length);
    const out = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  fixedString(length: number): string {
    const raw = this.bytes(length);
    const end = raw.indexOf(0);
    return new TextDecoder().decode(end === -1 ? raw : raw.subarray(0, end));
  }

  varU16(): number {
    const first = this.u8();
    if ((first & 0x80) === 0) return first;
    return ((first & 0x7f) << 8) | this.u8();
  }

  expect(value: number, name: string): void {
    const actual = this.u8();
    if (actual !== value) {
      throw new DecodeError(
        `Unexpected ${name}: found 0x${actual.toString(16)}, expected 0x${value.toString(16)}`,
        "UnexpectedByte",
      );
    }
  }

  require(length: number): void {
    if (this.remaining < length) {
      throw new DecodeError(
        `Packet was too short: needed ${length}, had ${this.remaining}`,
      );
    }
  }
}

export function encodeCdcCommand(
  cmd: number,
  payload?: Encoder,
  header = COMMAND_HEADER,
): Uint8Array {
  const body = new BinaryWriter();
  payload?.(body);
  const bodyBytes = body.finish();
  const writer = new BinaryWriter();
  writer.bytes(header).u8(cmd);
  if (bodyBytes.length > 0) writer.varU16(bodyBytes.length).bytes(bodyBytes);
  return writer.finish();
}

export function decodeCdcReplyPayload(
  data: BytesLike,
  cmd: number,
): BinaryReader {
  const reader = new BinaryReader(data);
  for (const byte of REPLY_HEADER) reader.expect(byte, "header");
  reader.expect(cmd, "cmd");
  const length = reader.varU16();
  reader.require(length);
  return new BinaryReader(reader.bytes(length));
}

export function encodeCdc2Command(
  cmd: number,
  ecmd: number,
  payload?: Encoder,
): Uint8Array {
  return encodeCdcCommand(cmd, (writer) => {
    const body = new BinaryWriter();
    payload?.(body);
    writer.u8(ecmd).varU16(body.length).bytes(body.finish());
  });
}

export type Cdc2Ack = "Ack" | "Nack" | "Unknown";

export function decodeCdc2ReplyPayload(
  data: BytesLike,
  cmd: number,
  ecmd: number,
): BinaryReader | Cdc2Ack {
  const reader = decodeCdcReplyPayload(data, cmd);
  reader.expect(ecmd, "ecmd");
  const length = reader.varU16();
  if (length === 1) {
    const ack = reader.u8();
    if (ack === 0x76) return "Ack";
    if (ack === 0xff) return "Nack";
    return "Unknown";
  }
  reader.require(length);
  return new BinaryReader(reader.bytes(length));
}

export interface Version {
  major: number;
  minor: number;
  build: number;
  beta: number;
}

export function readVersion(reader: BinaryReader): Version {
  return {
    major: reader.u8(),
    minor: reader.u8(),
    build: reader.u8(),
    beta: reader.u8(),
  };
}

export function writeVersion(writer: BinaryWriter, version: Version): void {
  writer.u8(version.major).u8(version.minor).u8(version.build).u8(version.beta);
}

export const ProductType = {
  Iq1Brain: 0x01,
  V5Brain: 0x10,
  V5Controller: 0x11,
  ExpBrain: 0x12,
  AiVision: 0x13,
  AirController: 0x20,
  AirHornet: 0x21,
  Aim: 0x30,
} as const;

export interface SystemVersionReply {
  version: Version;
  productType: number;
  flags: number;
}

export class SystemVersionPacket implements CdcCommand<SystemVersionReply> {
  readonly cmd = cmds.SYSTEM_VERSION;
  encode(): Uint8Array {
    return encodeCdcCommand(this.cmd);
  }
  decodeReply(data: BytesLike): SystemVersionReply {
    return decodeSystemVersionReply(data);
  }
}

export function decodeSystemVersionReply(data: BytesLike): SystemVersionReply {
  const reader = decodeCdcReplyPayload(data, cmds.SYSTEM_VERSION);
  return {
    version: readVersion(reader),
    productType: reader.u16(),
    flags: reader.u8(),
  };
}

export interface SystemAliveReply {
  version1: number;
  version2: number;
  bootSource: number;
  count: number;
}

export class SystemAlivePacket implements CdcCommand<SystemAliveReply> {
  readonly cmd = cmds.QUERY_1;
  encode(): Uint8Array {
    return encodeCdcCommand(this.cmd);
  }
  decodeReply(data: BytesLike): SystemAliveReply {
    const reader = decodeCdcReplyPayload(data, this.cmd);
    return {
      version1: reader.u32(),
      version2: reader.u32(),
      bootSource: reader.u8(),
      count: reader.u8(),
    };
  }
}

export interface BrainNameReply {
  name: string;
}

export class BrainNameGetPacket implements CdcCommand<BrainNameReply> {
  readonly cmd = cmds.BRAIN_NAME_GET;
  encode(): Uint8Array {
    return encodeCdcCommand(this.cmd);
  }
  decodeReply(data: BytesLike): BrainNameReply {
    return { name: decodeCdcReplyPayload(data, this.cmd).fixedString(8) };
  }
}

export class UserEnterPacket implements CdcCommand<void> {
  readonly cmd: number = cmds.USER_ENTER;
  encode(): Uint8Array {
    return encodeCdcCommand(this.cmd);
  }
  decodeReply(data: BytesLike): void {
    decodeCdcReplyPayload(data, this.cmd);
  }
}

export class UserExitPacket extends UserEnterPacket {
  override readonly cmd = cmds.USER_EXIT;
}

export class UserPlayPacket implements CdcCommand<void> {
  readonly cmd = cmds.USER_PLAY;
  constructor(readonly slot: number) {}
  encode(): Uint8Array {
    return encodeCdcCommand(this.cmd, (writer) => writer.u8(this.slot));
  }
  decodeReply(data: BytesLike): void {
    decodeCdcReplyPayload(data, this.cmd);
  }
}

export class UserStopPacket extends UserEnterPacket {
  override readonly cmd = cmds.USER_STOP;
}

export interface UserDataReply {
  channel: number;
  data?: string;
}

export class UserDataPacket implements CdcCommand<UserDataReply | Cdc2Ack> {
  readonly cmd = cmds.USER_CDC;
  readonly ecmd = ecmds.SYS_USER_FIFO;
  constructor(
    readonly channel: number,
    readonly write?: string,
  ) {}
  encode(): Uint8Array {
    return encodeCdc2Command(this.cmd, this.ecmd, (writer) => {
      writer.u8(this.channel);
      if (this.write != null) writer.fixedString(this.write, 224);
    });
  }
  decodeReply(data: BytesLike): UserDataReply | Cdc2Ack {
    const payload = decodeCdc2ReplyPayload(data, this.cmd, this.ecmd);
    if (!(payload instanceof BinaryReader)) return payload;
    const channel = payload.u8();
    return {
      channel,
      data:
        payload.remaining > 0
          ? payload.fixedString(payload.remaining)
          : undefined,
    };
  }
}

export interface FileTransferInitOptions {
  function: number;
  target: number;
  vendor: number;
  options: number;
  length: number;
  address: number;
  crc: number;
  type: number;
  timestamp: number;
  version: Version;
  name: string;
}

export class FileTransferInitPacket implements CdcCommand<Cdc2Ack> {
  readonly cmd = cmds.USER_CDC;
  readonly ecmd = ecmds.FT_INIT;
  constructor(readonly options: FileTransferInitOptions) {}
  encode(): Uint8Array {
    const o = this.options;
    return encodeCdc2Command(this.cmd, this.ecmd, (writer) => {
      writer
        .u8(o.function)
        .u8(o.target)
        .u8(o.vendor)
        .u8(o.options)
        .u32(o.length)
        .u32(o.address)
        .u32(o.crc)
        .u8(o.type)
        .u32(o.timestamp);
      writeVersion(writer, o.version);
      writer.fixedString(o.name, 24);
    });
  }
  decodeReply(data: BytesLike): Cdc2Ack {
    const payload = decodeCdc2ReplyPayload(data, this.cmd, this.ecmd);
    return payload instanceof BinaryReader ? "Ack" : payload;
  }
}

export class FileTransferWritePacket implements CdcCommand<Cdc2Ack> {
  readonly cmd = cmds.USER_CDC;
  readonly ecmd = ecmds.FT_WRITE;
  constructor(
    readonly address: number,
    readonly data: BytesLike,
  ) {}
  encode(): Uint8Array {
    return encodeCdc2Command(this.cmd, this.ecmd, (writer) =>
      writer.u32(this.address).bytes(this.data),
    );
  }
  decodeReply(data: BytesLike): Cdc2Ack {
    const payload = decodeCdc2ReplyPayload(data, this.cmd, this.ecmd);
    return payload instanceof BinaryReader ? "Ack" : payload;
  }
}

export class FileTransferExitPacket implements CdcCommand<Cdc2Ack> {
  readonly cmd = cmds.USER_CDC;
  readonly ecmd = ecmds.FT_EXIT;
  encode(): Uint8Array {
    return encodeCdc2Command(this.cmd, this.ecmd);
  }
  decodeReply(data: BytesLike): Cdc2Ack {
    const payload = decodeCdc2ReplyPayload(data, this.cmd, this.ecmd);
    return payload instanceof BinaryReader ? "Ack" : payload;
  }
}

export interface ScreenCaptureReply {
  width: number;
  height: number;
  data: Uint8Array;
}

export class ScreenCapturePacket implements CdcCommand<
  ScreenCaptureReply | Cdc2Ack
> {
  readonly cmd = cmds.USER_CDC;
  readonly ecmd = ecmds.SCREEN_CAP;
  encode(): Uint8Array {
    return encodeCdc2Command(this.cmd, this.ecmd);
  }
  decodeReply(data: BytesLike): ScreenCaptureReply | Cdc2Ack {
    const payload = decodeCdc2ReplyPayload(data, this.cmd, this.ecmd);
    if (!(payload instanceof BinaryReader)) return payload;
    return {
      width: payload.u16(),
      height: payload.u16(),
      data: payload.bytes(payload.remaining),
    };
  }
}

export function crc16(data: BytesLike): number {
  let crc = 0;
  for (const byte of toUint8Array(data)) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

export function crc32(data: BytesLike): number {
  let crc = 0xffffffff;
  for (const byte of toUint8Array(data)) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
