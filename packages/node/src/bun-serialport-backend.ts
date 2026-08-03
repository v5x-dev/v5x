import { platform as hostPlatform } from "node:os";
import type {
  NativeOpenOptions,
  NativePort,
  NativePortDescriptor,
  SerialBackend,
} from "./backend.js";
import {
  createLinuxPortLister,
  linuxDiscoveryOperations,
  type LinuxDiscoveryOperations,
} from "./linux-discovery.js";

/** `bun-serialport` ships native code for these platforms only. */
export const BUN_SERIALPORT_PLATFORMS = ["darwin", "linux"] as const;

export interface BunSerialportBackendOptions {
  /** Defaults to the host platform. */
  platform?: string;
  /** Overrides the sysfs reads used to enumerate ports on Linux. */
  linuxDiscovery?: LinuxDiscoveryOperations;
}

async function loadBunSerialport(): Promise<typeof import("bun-serialport")> {
  try {
    return await import("bun-serialport");
  } catch (cause) {
    throw new Error(
      "The default @v5x/node backend requires the optional `bun-serialport` peer dependency. Install it, or pass a `backend` your runtime supports to createNodeSerial().",
      { cause },
    );
  }
}

/**
 * The default backend. On Linux it enumerates ports from sysfs, because
 * `bun-serialport` reports paths there without the USB ids that Web Serial
 * filters match against.
 */
export function createBunSerialportBackend(
  options: BunSerialportBackendOptions = {},
): SerialBackend {
  const platform = options.platform ?? hostPlatform();
  const linuxDiscovery = options.linuxDiscovery ?? linuxDiscoveryOperations;
  const linuxList =
    platform === "linux" ? createLinuxPortLister(linuxDiscovery) : undefined;

  return {
    name: "bun-serialport",
    platforms: BUN_SERIALPORT_PLATFORMS,

    async list(): Promise<NativePortDescriptor[]> {
      if (linuxList !== undefined) return linuxList();
      return (await loadBunSerialport()).list();
    },

    async open({ path, baudRate }: NativeOpenOptions): Promise<NativePort> {
      const { SerialPort } = await loadBunSerialport();
      const port = new SerialPort({ path, baudRate, autoOpen: false });
      await port.open();
      return port;
    },
  };
}
