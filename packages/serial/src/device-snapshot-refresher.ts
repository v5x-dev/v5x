import type { ISmartDeviceInfo, MatchMode } from "./vex.js";
import type { V5SerialConnection } from "./v5-serial-connection.js";
import type { V5SerialDeviceState } from "./device-state.js";
import type {
  GetDeviceStatusReplyD2HPacket,
  GetRadioStatusReplyD2HPacket,
  GetSystemFlagsReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
} from "./packet.js";
import type { VexSerialError } from "./error.js";
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
      // Packet decoding owns this array for the duration of the refresh. The
      // apply step only retains it when at least one smart-device slot changed,
      // avoiding a clone on an unchanged telemetry poll.
      devices: deviceStatus.devices,
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
    const controller0 = this.state.controllers[0]!;
    const controller1 = this.state.controllers[1]!;
    if (!sameController(controller0, snapshot.controllers[0]))
      Object.assign(controller0, snapshot.controllers[0]);
    if (!sameController(controller1, snapshot.controllers[1]))
      Object.assign(controller1, snapshot.controllers[1]);
    if (!sameRadio(this.state.radio, snapshot.radio))
      Object.assign(this.state.radio, snapshot.radio);

    if (!sameSmartDeviceSlots(this.state.devices, snapshot.devices)) {
      const next: Array<ISmartDeviceInfo | undefined> = [];
      for (const device of snapshot.devices) next[device.port] = device;
      this.state.devices = next;
    }
    return true;
  }
}

function sameSmartDeviceSlots(
  left: Array<ISmartDeviceInfo | undefined>,
  right: readonly ISmartDeviceInfo[],
): boolean {
  let maxPort = -1;
  for (const device of right) maxPort = Math.max(maxPort, device.port);
  if (left.length !== maxPort + 1) return false;

  let matched = 0;
  let present = 0;
  for (const device of right) {
    const current = left[device.port];
    if (current === undefined || !sameSmartDevice(current, device)) {
      return false;
    }
    matched++;
  }
  for (const device of left) {
    if (device !== undefined) present++;
  }
  return matched === present;
}

function sameSmartDevice(
  left: ISmartDeviceInfo,
  right: ISmartDeviceInfo,
): boolean {
  return (
    left.port === right.port &&
    left.type === right.type &&
    left.status === right.status &&
    left.betaversion === right.betaversion &&
    left.version === right.version &&
    left.bootversion === right.bootversion
  );
}

function sameController(
  left: V5SerialDeviceState["controllers"][number],
  right: V5SerialDeviceState["controllers"][number],
): boolean {
  return (
    left.battery === right.battery &&
    left.isAvailable === right.isAvailable &&
    left.isCharging === right.isCharging
  );
}

function sameRadio(
  left: V5SerialDeviceState["radio"],
  right: V5SerialDeviceState["radio"],
): boolean {
  return (
    left.channel === right.channel &&
    left.latency === right.latency &&
    left.signalQuality === right.signalQuality &&
    left.signalStrength === right.signalStrength &&
    left.isRadioData === right.isRadioData &&
    left.isVexNet === right.isVexNet &&
    left.isConnected === right.isConnected &&
    left.isAvailable === right.isAvailable
  );
}
