import type {
  NativeOpenOptions,
  NativePort,
  NativePortDescriptor,
  SerialBackend,
} from "./backend.js";
import {
  createWindowsPortLister,
  type WindowsDiscoveryOperations,
} from "./windows-discovery.js";
import { openWindowsSerialPort, type Kernel32 } from "./windows-serial.js";

/** The Win32 communications API backend is used by Bun on Windows. */
export const WINDOWS_SERIAL_PLATFORMS = ["win32"] as const;

export interface WindowsSerialBackendOptions {
  /** Overrides the registry reads used to enumerate COM ports. */
  discovery?: WindowsDiscoveryOperations;
  /** Stands in for `kernel32.dll`. Defaults to the real library. */
  kernel32?: Kernel32;
  /** Milliseconds between reads on an open port. Defaults to 1. */
  readInterval?: number;
}

/**
 * Bun's Windows backend. It enumerates COM ports from the registry, because
 * Windows exposes the USB ids that Web Serial filters match against through
 * the device enumeration tree rather than through the port itself. Node.js
 * uses `createNodeSerialportBackend()` instead.
 */
export function createWindowsSerialBackend(
  options: WindowsSerialBackendOptions = {},
): SerialBackend {
  const { discovery, kernel32, readInterval } = options;
  const list = createWindowsPortLister(discovery);

  return {
    name: "windows-serial",
    platforms: WINDOWS_SERIAL_PLATFORMS,

    list(): Promise<NativePortDescriptor[]> {
      return list();
    },

    open({ path, baudRate }: NativeOpenOptions): Promise<NativePort> {
      return openWindowsSerialPort({
        path,
        baudRate,
        kernel32,
        readInterval,
      });
    },
  };
}
