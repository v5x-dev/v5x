import { VexFirmwareVersion } from "./VexFirmwareVersion.js";
import { type HostBoundPacket } from "./VexPacket.js";

const textDecoder = new TextDecoder("UTF-8");

export class PacketView extends DataView<ArrayBuffer> {
  position = 0;
  littleEndianDefault = true;

  constructor(
    buffer: ArrayBuffer,
    offset: number = 0,
    length: number = buffer.byteLength - offset,
  ) {
    super(buffer, offset, length);
  }

  static fromPacket(packet: HostBoundPacket): PacketView {
    const view = new PacketView(
      packet.data.buffer as ArrayBuffer,
      packet.data.byteOffset,
    );
    view.position = packet.ackIndex + 1;
    return view;
  }

  nextInt8(): number {
    return this.getInt8(this.position++);
  }

  nextUint8(): number {
    return this.getUint8(this.position++);
  }

  nextInt16(littleEndian = this.littleEndianDefault): number {
    const result = this.getInt16(this.position, littleEndian);
    this.position += 2;
    return result;
  }

  nextUint16(littleEndian = this.littleEndianDefault): number {
    const result = this.getUint16(this.position, littleEndian);
    this.position += 2;
    return result;
  }

  nextInt32(littleEndian = this.littleEndianDefault): number {
    const result = this.getInt32(this.position, littleEndian);
    this.position += 4;
    return result;
  }

  nextUint32(littleEndian = this.littleEndianDefault): number {
    const result = this.getUint32(this.position, littleEndian);
    this.position += 4;
    return result;
  }

  nextString(length: number): string {
    const result = textDecoder.decode(
      new Uint8Array(this.buffer, this.byteOffset + this.position, length),
    );
    this.position += length;
    return result;
  }

  /** Read a null-terminated string from a fixed-width `length`-byte field. */
  nextNTBS(length: number): string {
    const start = this.position;
    const result = this.nextVarNTBS(length);
    this.position = start + length;
    return result;
  }

  /** Read a null-terminated string of at most `length` bytes. */
  nextVarNTBS(length: number): string {
    const start = this.position;
    let byteLength = 0;
    for (let i = 0; i < length; i++) {
      if (this.byteLength <= this.position) break;
      const g = this.nextUint8();
      if (g === 0) break;
      byteLength++;
    }
    return textDecoder.decode(
      new Uint8Array(this.buffer, this.byteOffset + start, byteLength),
    );
  }

  nextVersion(reverse = false): VexFirmwareVersion {
    const result = VexFirmwareVersion.fromUint8Array(
      new Uint8Array(this.buffer, this.byteOffset, this.byteLength),
      this.position,
      reverse,
    );
    this.position += 4;
    return result;
  }
}
