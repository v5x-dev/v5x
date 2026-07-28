import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { NativePortDescriptor } from "./backend.js";
import { mapWithConcurrency } from "@v5x/internal/concurrency";

export type UsbAttributes = Pick<
  NativePortDescriptor,
  "vendorId" | "productId" | "serialNumber"
>;

export type ReadTextFile = (path: string) => Promise<string>;

const readTextFile: ReadTextFile = (path) => readFile(path, "utf8");

export const LINUX_DISCOVERY_CONCURRENCY = 8;

export interface LinuxDiscoveryOperations {
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  readUsbAttributes(device: string): Promise<UsbAttributes>;
}

export const linuxDiscoveryOperations: LinuxDiscoveryOperations = {
  readdir,
  realpath,
  readUsbAttributes: readLinuxUsbDeviceAttributes,
};

/**
 * Walks up from a tty's sysfs device node to the USB device that owns it and
 * reads its identity. Linux exposes USB ids there rather than through the
 * serial libraries, which otherwise report the path alone.
 */
export async function readLinuxUsbDeviceAttributes(
  device: string,
  readText: ReadTextFile = readTextFile,
): Promise<UsbAttributes> {
  let current = device;
  for (let i = 0; i < 5; i++, current = join(current, "..")) {
    try {
      const [vendorId, productId] = await Promise.all([
        readText(join(current, "idVendor")),
        readText(join(current, "idProduct")),
      ]);
      const serialNumber = await readText(join(current, "serial"))
        .then((value) => value.trim())
        .catch(() => undefined);
      return {
        vendorId: vendorId.trim(),
        productId: productId.trim(),
        serialNumber: serialNumber === "" ? undefined : serialNumber,
      };
    } catch {
      // Keep walking up toward the USB device node.
    }
  }
  return {};
}

export async function listLinuxPorts(
  operations: LinuxDiscoveryOperations = linuxDiscoveryOperations,
): Promise<NativePortDescriptor[]> {
  const ttys = await operations
    .readdir("/sys/class/tty")
    .then((names) => names.toSorted())
    .catch(() => []);
  const usbAttributes = new Map<string, Promise<UsbAttributes>>();

  const ports = await mapWithConcurrency(
    ttys,
    LINUX_DISCOVERY_CONCURRENCY,
    async (name): Promise<NativePortDescriptor | undefined> => {
      try {
        const device = await operations.realpath(
          `/sys/class/tty/${name}/device`,
        );
        const info: NativePortDescriptor = { path: `/dev/${name}` };

        // A USB serial port's immediate sysfs device commonly belongs to the
        // tty subsystem. Its USB identity is exposed by an ancestor, which is
        // why checking only `device/subsystem` misses ttyACM and ttyUSB ports.
        let attributes = usbAttributes.get(device);
        if (attributes === undefined) {
          attributes = operations.readUsbAttributes(device).catch(() => ({}));
          usbAttributes.set(device, attributes);
        }
        Object.assign(info, await attributes);
        return info;
      } catch {
        // Not a real device or no permission.
        return undefined;
      }
    },
  );
  return ports.filter((port) => port !== undefined);
}
