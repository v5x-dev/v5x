import type { ISmartDeviceInfo, MatchMode } from "./Vex.js";
import type { V5SerialConnection } from "./VexConnection.js";
import type { V5SerialDeviceState } from "./VexDeviceState.js";
import type {
  GetDeviceStatusReplyD2HPacket,
  GetRadioStatusReplyD2HPacket,
  GetSystemFlagsReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
} from "./VexPacket.js";
import type { VexSerialError } from "./VexError.js";
import { ok, type Result } from "neverthrow";

interface DeviceSnapshot {
  isAvailable: true;
  matchMode: MatchMode;
  isFieldControllerConnected: boolean;
  brain: V5SerialDeviceState["brain"];
  controllers: V5SerialDeviceState["controllers"];
  radio: V5SerialDeviceState["radio"];
  devices: ISmartDeviceInfo[];
}

/** Collects and atomically applies high-level device snapshots. */
export class DeviceSnapshotRefresher {
  private generation = 0;

  constructor(
    private readonly state: V5SerialDeviceState,
    private readonly isDisposed: () => boolean,
    private readonly isController: () => boolean,
  ) {}

  invalidate(): void {
    this.generation++;
  }

  async refresh(
    connection: V5SerialConnection | undefined,
  ): Promise<Result<boolean, VexSerialError>> {
    if (this.isDisposed()) return ok(false);

    const generation = ++this.generation;
    if (connection == null || !connection.isConnected) {
      this.applyIfCurrent(generation, { isAvailable: false });
      return ok(false);
    }

    const [systemStatus, systemFlags, radioStatus, deviceStatus] =
      await Promise.all([
        connection.getSystemStatus(),
        connection.getSystemFlags(),
        connection.getRadioStatus(),
        connection.getDeviceStatus(),
      ]);
    if (generation !== this.generation || this.isDisposed()) return ok(false);
    if (
      systemStatus.isErr() ||
      systemFlags.isErr() ||
      radioStatus.isErr() ||
      deviceStatus.isErr()
    ) {
      this.applyIfCurrent(generation, { isAvailable: false });
      return ok(false);
    }

    return ok(
      this.applyIfCurrent(
        generation,
        this.build(
          systemStatus.value,
          systemFlags.value,
          radioStatus.value,
          deviceStatus.value,
        ),
      ),
    );
  }

  private build(
    systemStatus: GetSystemStatusReplyD2HPacket,
    systemFlags: GetSystemFlagsReplyD2HPacket,
    radioStatus: GetRadioStatusReplyD2HPacket,
    deviceStatus: GetDeviceStatusReplyD2HPacket,
  ): DeviceSnapshot {
    const flags2 = systemStatus.sysflags[2]!;
    const matchMode: MatchMode =
      (flags2 & 0b00100000) !== 0
        ? "disabled"
        : (flags2 & 0b01000000) !== 0
          ? "autonomous"
          : "driver";
    const isFieldControllerConnected = (flags2 & 0b00010000) !== 0;

    const flags4 = systemStatus.sysflags[4]!;
    const usingLanguage = (flags4 & 0b11110000) >> 4;
    const isWhiteTheme = (flags4 & 0b00000100) !== 0;
    const isScreenReversed = (flags4 & 0b00000001) === 0;

    const flags5 = systemFlags.flags;
    const hasFlag = (bit: number): boolean =>
      (flags5 & (2 ** (32 - bit))) !== 0;
    const radioConnected = hasFlag(22);
    const controller0Available =
      radioConnected || systemFlags.controllerBatteryPercent !== undefined;

    return {
      isAvailable: true,
      matchMode,
      isFieldControllerConnected,
      brain: {
        ...this.state.brain,
        activeProgram: systemFlags.currentProgram,
        battery: {
          batteryPercent: systemFlags.battery ?? 0,
          isCharging: hasFlag(15),
        },
        button: { isPressed: hasFlag(17), isDoublePressed: hasFlag(14) },
        cpu0Version: systemStatus.cpu0Version,
        cpu1Version: systemStatus.cpu1Version,
        isAvailable: !this.isController() || radioConnected,
        settings: { isScreenReversed, isWhiteTheme, usingLanguage },
        systemVersion: systemStatus.systemVersion,
        uniqueId: systemStatus.uniqueId,
      },
      controllers: [
        {
          battery: systemFlags.controllerBatteryPercent ?? 0,
          isAvailable: controller0Available,
          isCharging: (flags2 & 0b10000000) !== 0,
        },
        {
          battery: systemFlags.partnerControllerBatteryPercent ?? 0,
          isAvailable: hasFlag(19),
          isCharging: undefined,
        },
      ],
      radio: {
        channel: radioStatus.channel,
        latency: radioStatus.timeslot,
        signalQuality: radioStatus.quality,
        signalStrength: radioStatus.strength,
        isRadioData: hasFlag(12),
        isVexNet: hasFlag(18),
        isConnected: radioConnected,
        isAvailable: hasFlag(23),
      },
      devices: deviceStatus.devices.map((device) => ({ ...device })),
    };
  }

  private applyIfCurrent(
    generation: number,
    snapshot: DeviceSnapshot | { isAvailable: false },
  ): boolean {
    if (this.isDisposed() || generation !== this.generation) return false;
    if (snapshot.isAvailable === false) {
      this.state.brain.isAvailable = false;
      return false;
    }

    this.state.matchMode = snapshot.matchMode;
    this.state.isFieldControllerConnected = snapshot.isFieldControllerConnected;
    const brain = this.state.brain;
    brain.activeProgram = snapshot.brain.activeProgram;
    brain.battery.batteryPercent = snapshot.brain.battery.batteryPercent;
    brain.battery.isCharging = snapshot.brain.battery.isCharging;
    brain.button.isPressed = snapshot.brain.button.isPressed;
    brain.button.isDoublePressed = snapshot.brain.button.isDoublePressed;
    if (brain.cpu0Version.compare(snapshot.brain.cpu0Version) !== 0)
      brain.cpu0Version = snapshot.brain.cpu0Version;
    if (brain.cpu1Version.compare(snapshot.brain.cpu1Version) !== 0)
      brain.cpu1Version = snapshot.brain.cpu1Version;
    brain.isAvailable = snapshot.brain.isAvailable;
    brain.settings.isScreenReversed = snapshot.brain.settings.isScreenReversed;
    brain.settings.isWhiteTheme = snapshot.brain.settings.isWhiteTheme;
    brain.settings.usingLanguage = snapshot.brain.settings.usingLanguage;
    if (brain.systemVersion.compare(snapshot.brain.systemVersion) !== 0)
      brain.systemVersion = snapshot.brain.systemVersion;
    brain.uniqueId = snapshot.brain.uniqueId;
    Object.assign(this.state.controllers[0]!, snapshot.controllers[0]);
    Object.assign(this.state.controllers[1]!, snapshot.controllers[1]);
    Object.assign(this.state.radio, snapshot.radio);

    const next: Array<ISmartDeviceInfo | undefined> = [];
    for (const device of snapshot.devices) next[device.port] = device;
    if (!sameSmartDeviceSlots(this.state.devices, next))
      this.state.devices = next;
    return true;
  }
}

function sameSmartDeviceSlots(
  left: Array<ISmartDeviceInfo | undefined>,
  right: Array<ISmartDeviceInfo | undefined>,
): boolean {
  return (
    left.length === right.length &&
    left.every((device, index) => {
      const next = right[index];
      return (
        device === next ||
        (device !== undefined &&
          next !== undefined &&
          device.port === next.port &&
          device.type === next.type &&
          device.status === next.status &&
          device.betaversion === next.betaversion &&
          device.version === next.version &&
          device.bootversion === next.bootversion)
      );
    })
  );
}
