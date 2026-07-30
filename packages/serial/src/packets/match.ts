import { PacketView } from "../packet-view.js";
import { type DataArray, type MatchMode } from "../vex.js";
import { DeviceBoundPacket, HostBoundPacket } from "../packet-base.js";

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
      this.data.slice(n + 18, n + 28),
    );
    const end = raw.indexOf("\0");
    this.robotName = end > -1 ? raw.slice(0, end) : raw;
  }
}
