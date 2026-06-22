import { AckType, type DataArray } from "./Vex.js";
import type { PacketEncoder } from "./VexPacketEncoder.js";

export abstract class Packet {
  data: Uint8Array; // the buffer sent to the device or received from the device

  static ENCODER: PacketEncoder;

  constructor(rawData: DataArray) {
    this.data =
      rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
  }
}

export class DeviceBoundPacket extends Packet {
  get commandId(): number {
    return (this.constructor as typeof DeviceBoundPacket).COMMAND_ID;
  }

  get commandExtendedId(): number | undefined {
    return (this.constructor as typeof DeviceBoundPacket).COMMAND_EXTENDED_ID;
  }

  static COMMAND_ID: number;
  static COMMAND_EXTENDED_ID: number | undefined;

  constructor(payload?: Uint8Array) {
    super(new Uint8Array());
    const me = this.constructor as typeof DeviceBoundPacket;

    if (me.COMMAND_EXTENDED_ID === undefined) {
      if (payload === undefined) {
        this.data = Packet.ENCODER.cdcCommand(me.COMMAND_ID);
      } else {
        this.data = Packet.ENCODER.cdcCommandWithData(me.COMMAND_ID, payload);
      }
    } else {
      if (payload === undefined) {
        this.data = Packet.ENCODER.cdc2Command(
          me.COMMAND_ID,
          me.COMMAND_EXTENDED_ID,
        );
      } else {
        this.data = Packet.ENCODER.cdc2CommandWithData(
          me.COMMAND_ID,
          me.COMMAND_EXTENDED_ID,
          payload,
        );
      }
    }
  }
}

export class HostBoundPacket extends Packet {
  ack: AckType = AckType.CDC2_NACK;
  payloadSize: number;
  ackIndex: number;

  constructor(data: DataArray) {
    super(data);

    this.payloadSize = Packet.ENCODER.getPayloadSize(this.data);
    const n = Packet.ENCODER.getHostHeaderLength(this.data);

    // skip command id check

    this.ack = this.data[(this.ackIndex = n + 1)]!;
  }

  static isValidPacket(data: Uint8Array, n: number): boolean {
    const ack = data[n + 1];
    return ack === AckType.CDC2_ACK || ack === 167; // XXX: got 167 from MatchStatusReplyD2HPacket
  }
}
