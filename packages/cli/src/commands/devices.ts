import type { Sade } from "sade";
import { SmartDeviceType, VexFirmwareVersion } from "@v5x/serial";
import { withV5Device } from "../device";
import { printJson, renderTable } from "../utils/output";

type SmartDevice = { port: number; type: number; version: number };

export const SMART_DEVICE_LABELS: Record<number, string> = {
  [SmartDeviceType.EMPTY]: "empty",
  [SmartDeviceType.V5_POWER]: "v5 power",
  [SmartDeviceType.MOTOR]: "motor",
  [SmartDeviceType.LED]: "led",
  [SmartDeviceType.ABS_ENCODER_SENSOR]: "abs encoder sensor",
  [SmartDeviceType.CR_MOTOR]: "cr motor",
  [SmartDeviceType.IMU_SENSOR]: "imu sensor",
  [SmartDeviceType.DISTANCE_SENSOR]: "distance sensor",
  [SmartDeviceType.RADIO_SENSOR]: "radio sensor",
  [SmartDeviceType.CONTROLLER]: "controller",
  [SmartDeviceType.BRAIN]: "brain",
  [SmartDeviceType.VISION_SENSOR]: "vision sensor",
  [SmartDeviceType.ADI]: "adi",
  [SmartDeviceType.PARTNER_CONTROLLER]: "partner controller",
  [SmartDeviceType.BATTERY]: "battery",
  [SmartDeviceType.SOL]: "solenoid",
  [SmartDeviceType.OPTICAL_SENSOR]: "optical sensor",
  [SmartDeviceType.MAGNET]: "magnet",
  [SmartDeviceType.GPS_SENSOR]: "gps sensor",
  [SmartDeviceType.UNDEFINED_SENSOR]: "undefined sensor",
};

export function formatSmartDeviceType(type: number): string {
  return SMART_DEVICE_LABELS[type] ?? `unknown (${type})`;
}

export function formatSmartDeviceVersion(version: number): string {
  return new VexFirmwareVersion(
    (version >>> 14) & 0xff,
    (version >>> 8) & 0x3f,
    version & 0xff,
    0,
  ).toUserString();
}

export function formatDeviceRows(devices: SmartDevice[]): string[][] {
  return devices.map(({ port, type, version }) => [
    port.toString(),
    formatSmartDeviceType(type),
    formatSmartDeviceVersion(version),
  ]);
}

export function toDeviceJson(devices: SmartDevice[]) {
  return devices.map(({ port, type, version }) => ({
    port,
    type,
    typeLabel: formatSmartDeviceType(type),
    version,
    versionString: formatSmartDeviceVersion(version),
  }));
}

export default function registerDevicesCommand(program: Sade) {
  program
    .command("devices", "list devices connected to brain", { alias: "lsdev" })
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const devices = device.devices;
        if (options.json === true) printJson(toDeviceJson(devices));
        else
          console.log(
            renderTable(["port", "type", "version"], formatDeviceRows(devices)),
          );
      });
    });
}
