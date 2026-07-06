import type { Sade } from "sade";
import { withV5Device } from "../device";
import { Table } from "cmd-table";
import { SmartDeviceType, VexFirmwareVersion } from "@v5x/serial";

type SmartDevice = {
  port: number;
  type: number;
  version: number;
};

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
  const major = (version >>> 14) & 0xff;
  const minor = (version >>> 8) & 0x3f;
  const patch = version & 0xff;
  return new VexFirmwareVersion(major, minor, patch, 0).toUserString();
}

export function formatDeviceRows(smartDevices: SmartDevice[]): string[][] {
  return smartDevices.map((device) => [
    device.port.toString(),
    formatSmartDeviceType(device.type),
    formatSmartDeviceVersion(device.version),
  ]);
}

export function toDeviceJson(smartDevices: SmartDevice[]) {
  return smartDevices.map((device) => ({
    port: device.port,
    type: device.type,
    typeLabel: formatSmartDeviceType(device.type),
    version: device.version,
    versionString: formatSmartDeviceVersion(device.version),
  }));
}

export default function registerDevicesCommand(program: Sade) {
  program
    .command("devices", "list devices connected to brain", { alias: "lsdev" })
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const smartDevices = device.devices;
        if (options.json === true) {
          console.log(JSON.stringify(toDeviceJson(smartDevices), null, 2));
          return;
        }

        const table = new Table({ compact: true });
        table.addColumn("port");
        table.addColumn("type");
        table.addColumn("version");
        formatDeviceRows(smartDevices).forEach((row) => table.addRow(row));
        console.log(table.render());
      });
    });
}
