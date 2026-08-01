import { platform as hostPlatform } from "node:os";
import type {
  NativeOpenOptions,
  NativePort,
  NativePortDescriptor,
  NativePortEventMap,
  SerialBackend,
} from "./backend.js";
import {
  createWindowsPortLister,
  type WindowsDiscoveryOperations,
} from "./windows-discovery.js";

/** `serialport` ships native bindings for the operating systems supported by v5x. */
export const NODE_SERIALPORT_PLATFORMS = ["darwin", "linux", "win32"] as const;

export interface NodeSerialportBackendOptions {
  /** Defaults to the host platform. */
  platform?: string;
  /** Overrides the registry reads used to enumerate COM ports on Windows. */
  windowsDiscovery?: WindowsDiscoveryOperations;
}

type SerialPortModule = typeof import("serialport");
type SerialPortInstance = InstanceType<SerialPortModule["SerialPort"]>;

async function loadSerialport(): Promise<SerialPortModule> {
  try {
    return await import("serialport");
  } catch (cause) {
    throw new Error(
      "The default @v5x/node backend requires the optional `serialport` peer dependency. Install it, or pass a `backend` your runtime supports to createNodeSerial().",
      { cause },
    );
  }
}

function toNativePort(port: SerialPortInstance): NativePort {
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        port.close((error) => (error == null ? resolve() : reject(error)));
      }),
    write: (data) =>
      new Promise<number>((resolve, reject) => {
        port.write(data, (error) =>
          error == null ? resolve(data.byteLength) : reject(error),
        );
      }),
    pause: () => {
      port.pause();
    },
    resume: () => {
      port.resume();
    },
    on<Event extends keyof NativePortEventMap>(
      event: Event,
      listener: (value: NativePortEventMap[Event]) => void,
    ): NativePort {
      if (event === "data") {
        port.on("data", listener as (data: Uint8Array) => void);
      } else {
        port.on("error", listener as (error: Error) => void);
      }
      return this;
    },
    off<Event extends keyof NativePortEventMap>(
      event: Event,
      listener: (value: NativePortEventMap[Event]) => void,
    ): NativePort {
      if (event === "data") {
        port.off("data", listener as (data: Uint8Array) => void);
      } else {
        port.off("error", listener as (error: Error) => void);
      }
      return this;
    },
    removeAllListeners(): NativePort {
      port.removeAllListeners();
      return this;
    },
  };
}

async function openSerialPort(
  module: SerialPortModule,
  options: NativeOpenOptions,
): Promise<NativePort> {
  const port = new module.SerialPort({
    path: options.path,
    baudRate: options.baudRate,
    autoOpen: false,
  });
  await new Promise<void>((resolve, reject) => {
    port.open((error) => (error == null ? resolve() : reject(error)));
  });
  return toNativePort(port);
}

function mapPortInfo(
  port: Awaited<ReturnType<SerialPortModule["SerialPort"]["list"]>>[number],
): NativePortDescriptor {
  return {
    path: port.path,
    vendorId: port.vendorId,
    productId: port.productId,
    serialNumber: port.serialNumber,
  };
}

/**
 * The default Node.js backend. It uses the `serialport` package instead of
 * Bun's native module or FFI, while retaining the registry-based Windows
 * enumeration needed to expose USB ids to Web Serial filters.
 */
export function createNodeSerialportBackend(
  options: NodeSerialportBackendOptions = {},
): SerialBackend {
  const platform = options.platform ?? hostPlatform();
  const windowsList =
    platform === "win32"
      ? createWindowsPortLister(options.windowsDiscovery)
      : undefined;

  return {
    name: "node-serialport",
    platforms: NODE_SERIALPORT_PLATFORMS,

    async list(): Promise<NativePortDescriptor[]> {
      if (windowsList !== undefined) return windowsList();
      const { SerialPort } = await loadSerialport();
      return (await SerialPort.list()).map(mapPortInfo);
    },

    async open(openOptions: NativeOpenOptions): Promise<NativePort> {
      return openSerialPort(await loadSerialport(), openOptions);
    },
  };
}
