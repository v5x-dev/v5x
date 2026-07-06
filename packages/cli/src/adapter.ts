import type { SerialPort as BunSerialPortRaw } from "bun-serialport";
import { readdir, realpath, readlink } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";

export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPort extends EventTarget {
  onconnect: (event: Event) => void;
  ondisconnect: (event: Event) => void;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
}

export interface Serial extends EventTarget {
  onconnect: (event: Event) => void;
  ondisconnect: (event: Event) => void;
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
}

export interface AdapterPortInfo {
  path: string;
  vendorId?: string;
  productId?: string;
}

async function listPorts(): Promise<AdapterPortInfo[]> {
  return (await import("bun-serialport")).list();
}

export class WebSerialPortAdapter extends EventTarget implements SerialPort {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  private port: BunSerialPortRaw | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private _readable: ReadableStream<Uint8Array> | null = null;
  private _writable: WritableStream<Uint8Array> | null = null;

  constructor(
    private readonly path: string,
    private readonly info: SerialPortInfo,
  ) {
    super();
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this._readable;
  }
  get writable(): WritableStream<Uint8Array> | null {
    return this._writable;
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.port) throw new Error("Port already open");

    const { SerialPort } = await import("bun-serialport");
    const port = new SerialPort({
      path: this.path,
      baudRate: options.baudRate,
      autoOpen: false,
    });
    await port.open();
    this.port = port;

    this._readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
        port.on("data", (data: Uint8Array) => controller.enqueue(data));
        port.on("error", (error) => {
          controller.error(error);
          this.close().catch(() => {});
        });
      },
      cancel: () => void this.close(),
    });

    this._writable = new WritableStream({
      write: async (chunk) => {
        if (!this.port) throw new Error("Port closed");
        await this.port.write(chunk);
      },
      close: () => this.close(),
    });
  }

  async close(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.port = null;

    try {
      this.controller?.close();
    } catch {
      // The controller may already have been closed by the native port.
    }
    this.controller = null;

    try {
      await port.close();
    } finally {
      try {
        port.removeAllListeners?.();
      } catch {
        // Some native serial implementations do not expose listener cleanup.
      }
      this._readable = null;
      this._writable = null;
      this.dispatchEvent(new Event("disconnect"));
    }
  }

  async forget(): Promise<void> {
    await this.close();
  }
}

export class WebSerialAdapter extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  private readonly ports = new Map<string, WebSerialPortAdapter>();

  constructor(
    private readonly os: NodeJS.Platform = platform(),
    private readonly list: () => Promise<AdapterPortInfo[]> = listPorts,
  ) {
    super();
  }

  private async listLinuxPorts(): Promise<AdapterPortInfo[]> {
    const ttys = await readdir("/sys/class/tty").catch(() => []);
    const ports: AdapterPortInfo[] = [];

    for (const name of ttys) {
      try {
        const device = await realpath(`/sys/class/tty/${name}/device`);
        const subsystem = await readlink(join(device, "subsystem")).catch(
          () => "",
        );
        const info: AdapterPortInfo = { path: `/dev/${name}` };

        if (subsystem.includes("usb")) {
          let current = device;
          for (let i = 0; i < 5; i++, current = join(current, "..")) {
            try {
              const [vendorId, productId] = await Promise.all([
                Bun.file(join(current, "idVendor")).text(),
                Bun.file(join(current, "idProduct")).text(),
              ]);
              info.vendorId = vendorId.trim();
              info.productId = productId.trim();
              break;
            } catch {
              // Keep walking up toward the USB device node.
            }
          }
        }
        ports.push(info);
      } catch {
        // Not a real device or no permission.
      }
    }
    return ports;
  }

  async getPorts(): Promise<SerialPort[]> {
    if (this.os === "win32") {
      throw new Error(
        "Windows serial access needs a Windows-capable serial backend; bun-serialport only supports Linux and macOS",
      );
    }

    const ports =
      this.os === "linux" ? await this.listLinuxPorts() : await this.list();

    const activePaths = new Set(ports.map((port) => port.path));
    for (const [path, port] of this.ports) {
      if (!activePaths.has(path) && port.readable === null)
        this.ports.delete(path);
    }

    return ports.map(({ path, vendorId, productId }) => {
      let adapter = this.ports.get(path);
      if (!adapter) {
        adapter = new WebSerialPortAdapter(path, {
          usbVendorId: vendorId
            ? parseInt(vendorId, 16)
            : this.os === "darwin"
              ? 10376
              : undefined,
          usbProductId: productId ? parseInt(productId, 16) : undefined,
        });
        this.ports.set(path, adapter);
      }
      return adapter;
    });
  }

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

    const port = ports.find((candidate) => {
      const info = candidate.getInfo();
      return filters.some(
        (filter) =>
          (filter.usbVendorId === undefined ||
            filter.usbVendorId === info.usbVendorId) &&
          (filter.usbProductId === undefined ||
            filter.usbProductId === info.usbProductId),
      );
    });
    if (port) return port;
    throw new Error("No port found matching filters");
  }
}

export const serial = new WebSerialAdapter();
