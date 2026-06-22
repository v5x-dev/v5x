import { CrcGenerator } from "./VexCRC";
import { HostBoundPacket, Packet } from "./VexPacketBase";
import * as AllPackets from "./VexPacketModels";

const textEncoder = new TextEncoder();

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

  vexVersion: number;

  crcgen: CrcGenerator;
  allPacketsTable: Record<string, typeof HostBoundPacket> = {};

  static getInstance(): PacketEncoder {
    if (Packet.ENCODER === undefined) {
      Packet.ENCODER = new PacketEncoder();
    }
    return Packet.ENCODER;
  }

  private constructor() {
    this.vexVersion = 0;
    this.crcgen = new CrcGenerator();

    Object.values(AllPackets).forEach((packet) => {
      if (
        typeof packet === "function" &&
        packet.prototype instanceof HostBoundPacket
      ) {
        const packetType = packet as unknown as typeof HostBoundPacket & {
          COMMAND_ID: number;
          COMMAND_EXTENDED_ID: number | undefined;
        };
        this.allPacketsTable[
          packetType.COMMAND_ID + " " + packetType.COMMAND_EXTENDED_ID
        ] = packetType;
      }
    });
  }

  /**
   * Create the vex CDC header
   * @param buf the bytes to send
   */
  createHeader(buf: ArrayBuffer | undefined): Uint8Array {
    // create a buffer if is is not defined
    if (buf === undefined || buf.byteLength < PacketEncoder.HEADERS_LENGTH) {
      buf = new ArrayBuffer(PacketEncoder.HEADERS_LENGTH);
    }
    const h = new Uint8Array(buf);
    h.set(PacketEncoder.HEADER_TO_DEVICE);
    return h;
  }

  /**
   * Create the vex CDC simple message
   * @param cmd the CDC command byte
   */
  cdcCommand(cmd: number): Uint8Array {
    const buf = new ArrayBuffer(PacketEncoder.HEADERS_LENGTH + 1);
    const h = this.createHeader(buf);
    h.set([cmd], PacketEncoder.HEADERS_LENGTH);
    return h;
  }

  /**
   * Create the vex CDC simple message
   * @param cmd the CDC command byte
   * @param data the data to send
   */
  cdcCommandWithData(cmd: number, data: Uint8Array): Uint8Array {
    const buf = new ArrayBuffer(PacketEncoder.HEADERS_LENGTH + 2 + data.length);
    const h = this.createHeader(buf);
    // add command and length bytes
    h.set([cmd, data.length], PacketEncoder.HEADERS_LENGTH);
    // add the message data
    h.set(data, PacketEncoder.HEADERS_LENGTH + 2);
    return h;
  }

  /**
   * Create the vex CDC extended message
   * @param cmd the CDC command byte
   * @param ext the CDC extended command byte
   * @return a message
   */
  cdc2Command(cmd: number, ext: number): Uint8Array {
    const buf = new ArrayBuffer(PacketEncoder.HEADERS_LENGTH + 5);
    const h = this.createHeader(buf);
    h.set([cmd, ext, 0], PacketEncoder.HEADERS_LENGTH);
    // Add CRC
    const crc = this.crcgen.crc16(h.subarray(0, buf.byteLength - 2), 0) >>> 0;
    h.set([crc >>> 8, crc & 0xff], buf.byteLength - 2);
    return h;
  }

  /**
   * Calculate buffer length for new CDC extended command
   * @param data the CDC extended command payload
   * @returns the required buffer length of the command message
   */
  cdc2CommandBufferLength(data: Uint8Array): number {
    // New command use header + 1 byte command
    //                        + 1 byte function
    //                        + 1 byte data length
    let length = PacketEncoder.HEADERS_LENGTH + data.length + 3 + 2;
    // If data length is > 127 bytes then an additional data length byte is added
    if (data.length > 127) length += 1;
    return length;
  }

  /**
   * Create the vex CDC extended message with some data
   * @param cmd the CDC command byte
   * @param ext the CDC extended command byte
   * @param data the CDC extended command payload
   * @return a message
   */
  cdc2CommandWithData(cmd: number, ext: number, data: Uint8Array): Uint8Array {
    const buf = new ArrayBuffer(this.cdc2CommandBufferLength(data));
    const h = this.createHeader(buf);
    // add command and length bytes
    if (data.length < 128) {
      h.set([cmd, ext, data.length], PacketEncoder.HEADERS_LENGTH);
      // add the message data
      h.set(data, PacketEncoder.HEADERS_LENGTH + 3);
    } else {
      const lengthMsb = ((data.length >>> 8) | 0x80) >>> 0;
      const lengthLsb = (data.length & 0xff) >>> 0;
      h.set([cmd, ext, lengthMsb, lengthLsb], PacketEncoder.HEADERS_LENGTH);
      // add the message data
      h.set(data, PacketEncoder.HEADERS_LENGTH + 4);
    }
    // Add CRC (little endian)
    const crc = this.crcgen.crc16(h.subarray(0, buf.byteLength - 2), 0);
    h.set([crc >>> 8, crc & 0xff], buf.byteLength - 2);
    return h;
  }

  validateHeader(data: Uint8Array): boolean {
    return !(
      data[0] !== PacketEncoder.HEADER_TO_HOST[0] ||
      data[1] !== PacketEncoder.HEADER_TO_HOST[1]
    );
  }

  validateMessageCdc(data: Uint8Array): boolean {
    const message = data.subarray(0, data.byteLength - 2);
    const lastTwoBytes =
      (data[data.byteLength - 2]! << 8) + data[data.byteLength - 1]!;
    return this.crcgen.crc16(message, 0) === lastTwoBytes;
  }

  getPayloadSize(data: Uint8Array): number {
    let t = 0;
    let a = data[3]!;
    if ((128 & a) !== 0) {
      t = 127 & a;
      a = data[4]!;
    }
    return (t << 8) + a;
  }

  getHostHeaderLength(data: Uint8Array): number {
    return (data[3]! & 0x80) === 0 ? 4 : 5;
  }
}
