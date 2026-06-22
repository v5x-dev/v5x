import type { Sade } from "sade";
import { connectV5Device } from "../device";
import { Table } from "cmd-table";
import { SmartDeviceType } from "@v5x/serial";

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

function formatVersion(version: number) {
  const major = (version >>> 14) & 0xff;
  const minor = (version >>> 8) & 0x3f;
  const patch = version & 0xff;

  return `${major}.${minor}.${patch}`;
}

export default function registerDevicesCommand(program: Sade) {
  program
    .command("devices", "list devices connected to brain", { alias: "lsdev" })
    .action(async () => {
      const device = await connectV5Device();
      try {
        const smartDevices = device.devices;
        const table = new Table({ compact: true });
        table.addColumn("port");
        table.addColumn("type");
        table.addColumn("version");
        smartDevices.forEach((d) => {
          table.addRow([
            d.port.toString(),
            SMART_DEVICE_LABELS[d.type],
            formatVersion(d.version),
          ]);
        });
        console.log(table.render());
      } finally {
        await device.dispose();
      }
    });
}
