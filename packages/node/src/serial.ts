import { matchesUsbFilters } from "@v5x/serial";
import { platform as hostPlatform } from "node:os";
import type { SerialBackend } from "./backend.js";
import { createBunSerialportBackend } from "./bun-serialport-backend.js";
import { SerialEventTarget } from "./event-target.js";
import { NodeSerialPort } from "./port.js";
import type {
  Serial,
  SerialPort,
  SerialPortFilter,
  SerialPortInfo,
} from "./types.js";

export interface NodeSerialOptions {
  /** Defaults to the `bun-serialport` backend. */
  backend?: SerialBackend;
  /** Defaults to the host platform; only used to validate backend support. */
  platform?: string;
}

/**
 * A `navigator.serial` for host runtimes. It enumerates the ports the backend
 * reports and hands out stable port objects, so a caller that enumerates twice
 * keeps talking to the port it already opened.
 */
export class NodeSerial extends SerialEventTarget implements Serial {
  private readonly ports = new Map<string, NodeSerialPort>();
  private readonly backend: SerialBackend;
  private readonly platform: string;

  constructor(options: NodeSerialOptions = {}) {
    super();
    this.backend = options.backend ?? createBunSerialportBackend();
    this.platform = options.platform ?? hostPlatform();
  }

  async getPorts(): Promise<SerialPort[]> {
    const supported = this.backend.platforms;
    if (supported !== undefined && !supported.includes(this.platform)) {
      throw new Error(
        `The ${this.backend.name} backend does not support ${this.platform}; pass a backend that does to createNodeSerial()`,
      );
    }

    const discovered = await this.backend.list();
    const activePaths = new Set(discovered.map((port) => port.path));
    for (const [path, port] of this.ports) {
      if (!activePaths.has(path) && port.isClosed) this.ports.delete(path);
    }

    return discovered.map(({ path, vendorId, productId, serialNumber }) => {
      const info: SerialPortInfo = {
        path,
        id: serialNumber ?? path,
        serialNumber,
        usbVendorId: vendorId ? parseInt(vendorId, 16) : undefined,
        usbProductId: productId ? parseInt(productId, 16) : undefined,
      };
      let port = this.ports.get(path);
      if (
        !port ||
        (port.isClosed && !serialPortInfoMatches(port.getInfo(), info))
      ) {
        port = new NodeSerialPort(this.backend, path, info);
        this.ports.set(path, port);
      }
      return port;
    });
  }

  /**
   * Web Serial prompts the person at the keyboard; a host process has no such
   * prompt, so this resolves the first matching port instead.
   */
  async requestPort(options?: {
    filters?: SerialPortFilter[];
  }): Promise<SerialPort> {
    const ports = await this.getPorts();
    const filters = options?.filters;
    if (!filters?.length) {
      const port = ports[0];
      if (port) return port;
      throw new Error("No port found");
    }

    const port = ports.find((candidate) =>
      matchesUsbFilters(candidate.getInfo(), filters),
    );
    if (port) return port;
    throw new Error("No port found matching filters");
  }
}

export function createNodeSerial(options: NodeSerialOptions = {}): NodeSerial {
  return new NodeSerial(options);
}

function serialPortInfoMatches(
  current: SerialPortInfo,
  discovered: SerialPortInfo,
): boolean {
  return (
    current.path === discovered.path &&
    current.id === discovered.id &&
    current.serialNumber === discovered.serialNumber &&
    current.usbVendorId === discovered.usbVendorId &&
    current.usbProductId === discovered.usbProductId
  );
}

/** The shared default instance, backed by `bun-serialport`. */
export const serial = new NodeSerial();
