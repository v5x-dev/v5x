import { CrcGenerator } from "./VexCRC.js";
import { HostBoundPacket, Packet } from "./VexPacketBase.js";
import * as AllPackets from "./VexPacketModels.js";

const textEncoder = new TextEncoder();
const HEADER_TO_DEVICE = Uint8Array.of(201, 54, 184, 71);

export function encodeFixedText(
  value: string,
  field: string,
  maxBytes: number,
): Uint8Array {
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength > maxBytes) {
    throw new RangeError(`${field} must be at most ${maxBytes} UTF-8 bytes`);
  }
  return encoded;
}

export class PacketEncoder {
  static HEADERS_LENGTH = 4;
  static HEADER_TO_DEVICE = [201, 54, 184, 71];
  static HEADER_TO_HOST = [170, 85];

  static J2000_EPOCH = 946684800;

  vexVersion = 0;

  crcgen = new CrcGenerator();
  allPacketsTable = new Map<
    number,
    Map<number | undefined, typeof HostBoundPacket>
  >();

  static getInstance(): PacketEncoder {
    Packet.ENCODER ??= new PacketEncoder();
    return Packet.ENCODER;
  }

  private constructor() {
    for (const packet of Object.values(AllPackets)) {
      if (
        typeof packet === "function" &&
        packet.prototype instanceof HostBoundPacket
      ) {
        const type = packet as typeof HostBoundPacket;
        let byExtendedId = this.allPacketsTable.get(type.COMMAND_ID);
        if (byExtendedId === undefined) {
          byExtendedId = new Map();
          this.allPacketsTable.set(type.COMMAND_ID, byExtendedId);
        }
        byExtendedId.set(type.COMMAND_EXTENDED_ID, type);
      }
    }
  }

  /** Look up the reply class registered for a command ID pair. */
  getPacketType(
    commandId: number | undefined,
    commandExtendedId: number | undefined,
  ): typeof HostBoundPacket | undefined {
    if (commandId === undefined) return undefined;
    return this.allPacketsTable.get(commandId)?.get(commandExtendedId);
  }

  /** Create the vex CDC header. */
  createHeader(buf: ArrayBuffer | undefined): Uint8Array {
    if (buf === undefined || buf.byteLength < PacketEncoder.HEADERS_LENGTH) {
      buf = new ArrayBuffer(PacketEncoder.HEADERS_LENGTH);
    }
    const h = new Uint8Array(buf);
    h.set(HEADER_TO_DEVICE);
    return h;
  }

  /** Create a simple CDC message. */
  cdcCommand(cmd: number): Uint8Array {
    const h = new Uint8Array(5);
    h.set(HEADER_TO_DEVICE);
    h[4] = cmd;
    return h;
  }

  /** Create a simple CDC message carrying data. */
  cdcCommandWithData(cmd: number, data: Uint8Array): Uint8Array {
    const h = new Uint8Array(6 + data.length);
    h.set(HEADER_TO_DEVICE);
    h[4] = cmd;
    h[5] = data.length;
    h.set(data, 6);
    return h;
  }

  /** Create a CDC2 (extended) message with no payload. */
  cdc2Command(cmd: number, ext: number): Uint8Array {
    const h = new Uint8Array(9);
    h.set(HEADER_TO_DEVICE);
    h[4] = cmd;
    h[5] = ext;
    h[6] = 0;
    this.appendCrc16(h);
    return h;
  }

  /**
   * Buffer length for a CDC2 command: header + command byte + function
   * byte + length byte (two bytes when payload > 127) + payload + CRC16.
   */
  cdc2CommandBufferLength(data: Uint8Array): number {
    return (
      PacketEncoder.HEADERS_LENGTH +
      data.length +
      5 +
      (data.length > 127 ? 1 : 0)
    );
  }

  /** Create a CDC2 (extended) message carrying a payload. */
  cdc2CommandWithData(cmd: number, ext: number, data: Uint8Array): Uint8Array {
    const h = new Uint8Array(this.cdc2CommandBufferLength(data));
    h.set(HEADER_TO_DEVICE);
    h[4] = cmd;
    h[5] = ext;
    if (data.length < 128) {
      h[6] = data.length;
      h.set(data, 7);
    } else {
      h[6] = (data.length >>> 8) | 0x80;
      h[7] = data.length & 0xff;
      h.set(data, 8);
    }
    this.appendCrc16(h);
    return h;
  }

  private appendCrc16(h: Uint8Array): void {
    const crc = this.crcgen.crc16(h.subarray(0, h.length - 2), 0);
    h[h.length - 2] = crc >>> 8;
    h[h.length - 1] = crc & 0xff;
  }

  validateHeader(data: Uint8Array): boolean {
    return (
      data[0] === PacketEncoder.HEADER_TO_HOST[0] &&
      data[1] === PacketEncoder.HEADER_TO_HOST[1]
    );
  }

  validateMessageCdc(data: Uint8Array): boolean {
    const crc = (data[data.byteLength - 2]! << 8) + data[data.byteLength - 1]!;
    return this.crcgen.crc16(data.subarray(0, data.byteLength - 2), 0) === crc;
  }

  getPayloadSize(data: Uint8Array): number {
    const a = data[3]!;
    return (a & 0x80) === 0 ? a : ((a & 0x7f) << 8) + data[4]!;
  }

  getHostHeaderLength(data: Uint8Array): number {
    return (data[3]! & 0x80) === 0 ? 4 : 5;
  }
}
