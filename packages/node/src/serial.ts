import { matchesUsbFilters } from "@v5x/serial";
import { platform as hostPlatform } from "node:os";
import type { SerialBackend } from "./backend.js";
import { createDefaultSerialBackend } from "./default-backend.js";
import { SerialConnectionEvent } from "./connection-event.js";
import { SerialEventTarget } from "./event-target.js";
import { NodeSerialPort } from "./port.js";
import type {
  Serial,
  SerialPort,
  SerialPortFilter,
  SerialPortInfo,
} from "./types.js";

export interface NodeSerialOptions {
  /** Defaults to the backend that drives the platform below. */
  backend?: SerialBackend;
  /**
   * Defaults to the host platform. It selects the default backend and
   * validates that the backend in use supports the platform.
   */
  platform?: string;
  /** Milliseconds between hotplug checks. Defaults to 250. */
  hotplugPollInterval?: number;
  /** Maximum interval used after unchanged scans. Defaults to 4 times the base. */
  maxHotplugPollInterval?: number;
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
  private readonly hotplugPollInterval: number;
  private readonly maxHotplugPollInterval: number;
  private currentHotplugPollInterval: number;
  private activePaths: Set<string> | undefined;
  private enumeration: Promise<SerialPort[]> | undefined;
  private hotplugTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEnumerationChanged = true;

  constructor(options: NodeSerialOptions = {}) {
    super();
    this.platform = options.platform ?? hostPlatform();
    this.backend = options.backend ?? createDefaultSerialBackend(this.platform);
    this.hotplugPollInterval = options.hotplugPollInterval ?? 250;
    this.maxHotplugPollInterval =
      options.maxHotplugPollInterval ?? this.hotplugPollInterval * 4;
    if (
      !Number.isFinite(this.hotplugPollInterval) ||
      this.hotplugPollInterval <= 0
    ) {
      throw new Error("hotplugPollInterval must be greater than zero");
    }
    if (
      !Number.isFinite(this.maxHotplugPollInterval) ||
      this.maxHotplugPollInterval < this.hotplugPollInterval
    ) {
      throw new Error(
        "maxHotplugPollInterval must be at least hotplugPollInterval",
      );
    }
    this.currentHotplugPollInterval = this.hotplugPollInterval;
  }

  async getPorts(): Promise<SerialPort[]> {
    if (this.enumeration !== undefined) return this.enumeration;

    const enumeration = this.enumeratePorts();
    this.enumeration = enumeration;
    try {
      return await enumeration;
    } finally {
      if (this.enumeration === enumeration) this.enumeration = undefined;
      if (this.activePaths !== undefined) {
        this.currentHotplugPollInterval = this.lastEnumerationChanged
          ? this.hotplugPollInterval
          : Math.min(
              this.maxHotplugPollInterval,
              this.currentHotplugPollInterval * 2,
            );
        this.scheduleHotplugCheck(this.currentHotplugPollInterval);
      }
    }
  }

  private async enumeratePorts(): Promise<SerialPort[]> {
    const supported = this.backend.platforms;
    if (supported !== undefined && !supported.includes(this.platform)) {
      throw new Error(
        `The ${this.backend.name} backend does not support ${this.platform}; pass a backend that does to createNodeSerial()`,
      );
    }

    const discovered = await this.backend.list();
    const activePaths = new Set(discovered.map((port) => port.path));
    this.lastEnumerationChanged = this.dispatchHotplugEvents(activePaths);
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

  private dispatchHotplugEvents(nextPaths: Set<string>): boolean {
    const previousPaths = this.activePaths;
    this.activePaths = nextPaths;
    if (previousPaths === undefined) return true;

    let changed = false;

    for (const path of previousPaths) {
      if (nextPaths.has(path)) continue;
      changed = true;
      // Web Serial reports a removal on the port itself and then once more on
      // the Serial object, carrying the port that went away. The port entry is
      // still in the map here; the cleanup pass below prunes it afterwards.
      const port = this.ports.get(path);
      port?.notifyDeviceRemoved();
      this.dispatchEvent(new SerialConnectionEvent("disconnect", port));
    }
    for (const path of nextPaths) {
      if (!previousPaths.has(path)) {
        changed = true;
        this.dispatchEvent(new Event("connect"));
      }
    }
    return changed;
  }

  private scheduleHotplugCheck(delay = this.currentHotplugPollInterval): void {
    if (this.hotplugTimer !== undefined) return;

    this.hotplugTimer = setTimeout(() => {
      this.hotplugTimer = undefined;
      void this.getPorts().catch(() => {
        // A transient discovery failure must not stop future hotplug checks.
      });
    }, delay);
    this.hotplugTimer.unref?.();
  }

  /**
   * Web Serial prompts the person at the keyboard; a host process has no such
   * prompt, so this resolves the first matching port instead.
   */
  async requestPort(options?: {
    filters?: SerialPortFilter[];
  }): Promise<SerialPort> {
    // An explicit request is a user-visible connection attempt. Do not make
    // it wait behind an idle backoff accumulated by the background watcher.
    this.currentHotplugPollInterval = this.hotplugPollInterval;
    if (this.hotplugTimer !== undefined) {
      clearTimeout(this.hotplugTimer);
      this.hotplugTimer = undefined;
    }
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

/** The shared default instance, backed by whichever backend fits the host. */
export const serial = new NodeSerial();
