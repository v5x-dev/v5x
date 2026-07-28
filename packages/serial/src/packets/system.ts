import { PacketView } from "../packet-view.js";
import { type DataArray, type ISmartDeviceInfo } from "../vex.js";
import { VexFirmwareVersion } from "../firmware-version.js";
import { DeviceBoundPacket, HostBoundPacket } from "../packet-base.js";

const clamp100 = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.max(0, Math.min(100, value));

export class Query1H2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 33;
  static COMMAND_EXTENDED_ID = undefined;
}

export class SystemVersionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 164;
  static COMMAND_EXTENDED_ID = undefined;
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
