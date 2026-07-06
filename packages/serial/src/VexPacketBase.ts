import { AckType, type DataArray } from "./Vex.js";
import type { PacketEncoder } from "./VexPacketEncoder.js";

// The match-status reply acknowledges with 167 instead of CDC2_ACK.
const MATCH_STATUS_ALT_ACK = 167;

export abstract class Packet {
  /** Raw bytes sent to or received from the device. */
  data: Uint8Array;

  static ENCODER: PacketEncoder;

  constructor(rawData: DataArray) {
    this.data =
      rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
  }
}

export class DeviceBoundPacket extends Packet {
  static COMMAND_ID: number;
  static COMMAND_EXTENDED_ID: number | undefined;

  get commandId(): number {
    return (this.constructor as typeof DeviceBoundPacket).COMMAND_ID;
  }

  get commandExtendedId(): number | undefined {
    return (this.constructor as typeof DeviceBoundPacket).COMMAND_EXTENDED_ID;
  }

  constructor(payload?: Uint8Array) {
    const { COMMAND_ID: cmd, COMMAND_EXTENDED_ID: ext } =
      new.target as typeof DeviceBoundPacket;
    const encoder = Packet.ENCODER;
    super(
      ext === undefined
        ? payload === undefined
          ? encoder.cdcCommand(cmd)
          : encoder.cdcCommandWithData(cmd, payload)
        : payload === undefined
          ? encoder.cdc2Command(cmd, ext)
          : encoder.cdc2CommandWithData(cmd, ext, payload),
    );
  }
}

export class HostBoundPacket extends Packet {
  static COMMAND_ID: number;
  static COMMAND_EXTENDED_ID: number | undefined;

  ack: AckType;
  payloadSize: number;
  ackIndex: number;

  constructor(data: DataArray) {
    super(data);
    this.payloadSize = Packet.ENCODER.getPayloadSize(this.data);
    this.ackIndex = Packet.ENCODER.getHostHeaderLength(this.data) + 1;
    this.ack = this.data[this.ackIndex]!;
  }

  static isValidPacket(data: Uint8Array, n: number): boolean {
    const ack = data[n + 1];
    return ack === AckType.CDC2_ACK || ack === MATCH_STATUS_ALT_ACK;
  }
}
