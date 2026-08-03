import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NativePortDescriptor } from "./backend.js";
import type { UsbAttributes } from "./linux-discovery.js";

const run = promisify(execFile);

/** Lists the COM ports the host currently exposes. */
const SERIALCOMM_KEY = "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM";
/** Carries the `PortName` a driver assigned to each enumerated USB device. */
const USB_ENUM_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB";

/** `reg query` prints more than a megabyte when the USB tree is large. */
const REGISTRY_OUTPUT_LIMIT = 32 * 1024 * 1024;

export interface WindowsDiscoveryOperations {
  /** Raw `reg query` output for the present-COM-port device map. */
  readSerialComm(): Promise<string>;
  /** Raw `reg query` output for the `PortName` values under the USB tree. */
  readUsbPortNames(): Promise<string>;
}

async function queryRegistry(...args: string[]): Promise<string> {
  const { stdout } = await run("reg", args, {
    maxBuffer: REGISTRY_OUTPUT_LIMIT,
    windowsHide: true,
  });
  return stdout;
}

export const windowsDiscoveryOperations: WindowsDiscoveryOperations = {
  readSerialComm: () => queryRegistry("query", SERIALCOMM_KEY),
  readUsbPortNames: () =>
    queryRegistry("query", USB_ENUM_KEY, "/s", "/v", "PortName"),
};

/** `    <name>    REG_SZ    <data>`, as `reg query` prints value rows. */
const VALUE_ROW = /^\s+(.+?)\s{2,}REG_[A-Z_]+\s{2,}(.*)$/;
const COM_PORT_NAME = /^COM\d+$/i;
/**
 * `...\USB\VID_2888&PID_0501\5B00F5A4\Device Parameters`. A composite device
 * carries an `MI_xx` interface suffix that is not part of the product id.
 */
const USB_INSTANCE_KEY =
  /\\USB\\VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})(?:&MI_[0-9A-Fa-f]{2})?\\([^\\]+)/;

/**
 * Reads the COM port names out of a `SERIALCOMM` device map dump. Windows
 * lists a port there only while its device is attached, which makes this the
 * enumeration source; the USB tree below keeps entries for devices that were
 * unplugged long ago.
 */
export function parseComPortNames(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = VALUE_ROW.exec(line);
    if (match === null) continue;
    const data = match[2]?.trim();
    if (data !== undefined && COM_PORT_NAME.test(data)) {
      names.add(data.toUpperCase());
    }
  }
  return [...names].toSorted();
}

/**
 * Maps each COM port name to the identity of the USB device that owns it.
 * Windows exposes USB ids through the device instance path rather than
 * through the port itself, which is why enumeration reads the `Enum` tree
 * instead of asking the serial API.
 */
export function parseUsbPortAttributes(
  output: string,
): Map<string, UsbAttributes> {
  const attributes = new Map<string, UsbAttributes>();
  const ambiguous = new Set<string>();
  let instance: RegExpExecArray | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) {
      instance = USB_INSTANCE_KEY.exec(line);
      continue;
    }

    const match = VALUE_ROW.exec(line);
    if (match === null || instance === null) continue;
    if (match[1]?.trim().toLowerCase() !== "portname") continue;

    const port = match[2]?.trim();
    const vendorId = instance[1];
    const productId = instance[2];
    const instanceId = instance[3];
    if (
      port === undefined ||
      vendorId === undefined ||
      productId === undefined
    ) {
      continue;
    }

    const identity: UsbAttributes = {
      vendorId: vendorId.toLowerCase(),
      productId: productId.toLowerCase(),
    };
    // Windows synthesises an instance id containing `&` when the device
    // reports no serial number of its own.
    if (instanceId !== undefined && !instanceId.includes("&")) {
      identity.serialNumber = instanceId;
    }
    // The USB enum retains unplugged device keys. If a COM number has been
    // reused, the registry can contain both the old and current PortName;
    // refusing an ambiguous identity is safer than matching a filter to the
    // wrong physical device.
    const portName = port.toUpperCase();
    if (ambiguous.has(portName)) continue;
    if (attributes.has(portName)) {
      attributes.delete(portName);
      ambiguous.add(portName);
      continue;
    }
    attributes.set(portName, identity);
  }

  return attributes;
}

/**
 * Enumerates COM ports with the USB identity Web Serial filters match against.
 *
 * The USB tree is expensive to walk and changes only when a device is
 * attached, so the returned lister caches what it resolved and re-reads only
 * when a port it has not seen before appears. Entries for ports that went away
 * are dropped, so a COM name that Windows later reassigns is resolved again.
 */
export function createWindowsPortLister(
  operations: WindowsDiscoveryOperations = windowsDiscoveryOperations,
): () => Promise<NativePortDescriptor[]> {
  const resolved = new Map<string, UsbAttributes>();
  const descriptors = new Map<string, NativePortDescriptor>();

  return async function listWindowsPorts(): Promise<NativePortDescriptor[]> {
    const names = parseComPortNames(
      await operations.readSerialComm().catch(() => ""),
    );

    for (const name of [...resolved.keys()]) {
      if (!names.includes(name)) {
        resolved.delete(name);
        descriptors.delete(name);
      }
    }

    if (names.some((name) => !resolved.has(name))) {
      try {
        const discovered = parseUsbPortAttributes(
          await operations.readUsbPortNames(),
        );
        for (const name of names) {
          // A port with no USB entry is a built-in or virtual COM port. Record
          // the empty identity so it is not looked up again on every poll.
          resolved.set(name, discovered.get(name) ?? {});
        }
      } catch {
        // Keep unresolved names out of the cache. A transient registry error
        // must not permanently hide the USB ids needed by requestPort()
        // filters; the next hotplug poll will retry this walk.
      }
    }

    return names.map((name) => {
      const identity = resolved.get(name) ?? {};
      const previous = descriptors.get(name);
      if (previous !== undefined && sameUsbAttributes(previous, identity)) {
        return previous;
      }
      const descriptor = { path: name, ...identity };
      descriptors.set(name, descriptor);
      return descriptor;
    });
  };
}

function sameUsbAttributes(
  descriptor: NativePortDescriptor,
  attributes: UsbAttributes,
): boolean {
  return (
    descriptor.vendorId === attributes.vendorId &&
    descriptor.productId === attributes.productId &&
    descriptor.serialNumber === attributes.serialNumber
  );
}
