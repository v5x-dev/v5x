import { PacketView } from "../packet-view.js";
import {
  type DataArray,
  type SelectDashScreen,
  USER_FIFO_MAX_WRITE_SIZE,
  type UserFifoChannel,
} from "../vex.js";
import { DeviceBoundPacket, HostBoundPacket } from "../packet-base.js";
import { encodeFixedText } from "../packet-encoder.js";

/**
 * Read from, and optionally write to, a user-program FIFO buffer.
 *
 * A request with no `write` payload only drains the channel. The brain always
 * answers with whatever it currently holds for that channel, so an empty reply
 * means "nothing buffered", not a failure.
 */
export class UserFifoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 39;

  constructor(channel: UserFifoChannel, write?: Uint8Array) {
    const length = write?.byteLength ?? 0;
    if (length > USER_FIFO_MAX_WRITE_SIZE) {
      throw new RangeError(
        `user FIFO writes must be at most ${USER_FIFO_MAX_WRITE_SIZE} bytes`,
      );
    }
    const payload = new Uint8Array(2 + length);
    payload[0] = channel;
    payload[1] = length;
    if (write !== undefined) payload.set(write, 2);
    super(payload);
  }
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
    const strv = encodeFixedText(value, "Value", 0x7fff);
    if (strk.byteLength + strv.byteLength + 20 > 0x7fff) {
      throw new RangeError("Key and value are too large for a protocol packet");
    }

    const payload = new Uint8Array(strk.length + strv.length + 20);
    payload.set(strk, 0);
    payload.set(strv, strk.length + 1);
    super(payload);
  }
}

export class UserFifoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86;
  static COMMAND_EXTENDED_ID = 39;

  channel: number;
  /**
   * Bytes drained from the channel, as a view over the reply. The brain may
   * pad the tail with NULs, which {@link readUserFifo} strips before the bytes
   * reach a caller.
   */
  buf: Uint8Array;

  constructor(data: DataArray) {
    super(data);
    const view = PacketView.fromPacket(this);
    this.channel = view.nextUint8();
    // The payload size covers the extended id, the ack, the channel byte, the
    // FIFO bytes, and the trailing CRC16.
    const length = Math.max(0, this.payloadSize - 5);
    this.buf = this.data.subarray(view.position, view.position + length);
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
