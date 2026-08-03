import { readdir, readFile, realpath } from "node:fs/promises";
import { posix } from "node:path";
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
  for (let i = 0; i < 5; i++, current = posix.join(current, "..")) {
    try {
      const [vendorId, productId] = await Promise.all([
        readText(posix.join(current, "idVendor")),
        readText(posix.join(current, "idProduct")),
      ]);
      const serialNumber = await readText(posix.join(current, "serial"))
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
  return createLinuxPortLister(operations)();
}

/**
 * Create a lister that keeps sysfs identity reads across discovery polls.
 * Resolving a tty path is cheap enough to repeat: it also tells us when a
 * name has been reattached to a different device. The expensive walk from
 * that resolved path to USB attributes is cached until the path disappears.
 */
export function createLinuxPortLister(
  operations: LinuxDiscoveryOperations = linuxDiscoveryOperations,
): () => Promise<NativePortDescriptor[]> {
  const attributesByDevice = new Map<string, UsbAttributes>();
  const portsByName = new Map<
    string,
    {
      device: string;
      attributes: UsbAttributes;
      descriptor: NativePortDescriptor;
    }
  >();

  return async function listCachedLinuxPorts(): Promise<
    NativePortDescriptor[]
  > {
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

          // A USB serial port's immediate sysfs device commonly belongs to the
          // tty subsystem. Its USB identity is exposed by an ancestor, which is
          // why checking only `device/subsystem` misses ttyACM and ttyUSB ports.
          let attributes = attributesByDevice.get(device);
          if (attributes === undefined) {
            let pending = usbAttributes.get(device);
            if (pending === undefined) {
              pending = operations.readUsbAttributes(device).catch(() => ({}));
              usbAttributes.set(device, pending);
            }
            attributes = await pending;
            attributesByDevice.set(device, attributes);
          }
          const previous = portsByName.get(name);
          if (
            previous !== undefined &&
            previous.device === device &&
            sameUsbAttributes(previous.attributes, attributes)
          ) {
            return previous.descriptor;
          }
          const descriptor = { path: `/dev/${name}`, ...attributes };
          portsByName.set(name, { device, attributes, descriptor });
          return descriptor;
        } catch {
          // Not a real device or no permission.
          return undefined;
        }
      },
    );
    const present = new Set(ttys);
    for (const name of portsByName.keys()) {
      if (!present.has(name)) portsByName.delete(name);
    }
    const activeDevices = new Set(
      [...portsByName.values()].map(({ device }) => device),
    );
    for (const device of attributesByDevice.keys()) {
      if (!activeDevices.has(device)) attributesByDevice.delete(device);
    }
    return ports.filter((port) => port !== undefined);
  };
}

function sameUsbAttributes(left: UsbAttributes, right: UsbAttributes): boolean {
  return (
    left.vendorId === right.vendorId &&
    left.productId === right.productId &&
    left.serialNumber === right.serialNumber
  );
}
