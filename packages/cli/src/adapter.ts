import type { SerialPort as BunSerialPortRaw } from "bun-serialport";
import { readdir, realpath, readlink } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import { mapWithConcurrency } from "./utils/concurrency";

export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  path?: string;
  id?: string;
  serialNumber?: string;
}

export interface SerialPort extends EventTarget {
  onconnect: ((event: Event) => void) | null;
  ondisconnect: ((event: Event) => void) | null;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
}

export interface Serial extends EventTarget {
  onconnect: ((event: Event) => void) | null;
  ondisconnect: ((event: Event) => void) | null;
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
}

export interface AdapterPortInfo {
  path: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

async function listPorts(): Promise<AdapterPortInfo[]> {
  return (await import("bun-serialport")).list();
}

type ReadTextFile = (path: string) => Promise<string>;

const readTextFile: ReadTextFile = (path) => Bun.file(path).text();

export const LINUX_DISCOVERY_CONCURRENCY = 8;

interface LinuxDiscoveryOperations {
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
  readUsbAttributes(
    device: string,
  ): Promise<Pick<AdapterPortInfo, "vendorId" | "productId" | "serialNumber">>;
}

const linuxDiscoveryOperations: LinuxDiscoveryOperations = {
  readdir,
  realpath,
  readlink,
  readUsbAttributes: readLinuxUsbDeviceAttributes,
};

type SerialEventHandler = ((event: Event) => void) | null;

class WebSerialEventTarget extends EventTarget {
  private connectHandler: SerialEventHandler = null;
  private disconnectHandler: SerialEventHandler = null;

  constructor() {
    super();
    this.addEventListener("connect", (event) =>
      this.invokeHandler(this.connectHandler, event),
    );
    this.addEventListener("disconnect", (event) =>
      this.invokeHandler(this.disconnectHandler, event),
    );
  }

  get onconnect(): SerialEventHandler {
    return this.connectHandler;
  }

  set onconnect(handler: SerialEventHandler) {
    this.connectHandler = handler;
  }

  get ondisconnect(): SerialEventHandler {
    return this.disconnectHandler;
  }

  set ondisconnect(handler: SerialEventHandler) {
    this.disconnectHandler = handler;
  }

  private invokeHandler(handler: SerialEventHandler, event: Event): void {
    try {
      handler?.call(this, event);
    } catch {
      // Consumer callbacks cannot interrupt other listeners or cleanup.
    }
  }
}

export async function readLinuxUsbDeviceAttributes(
  device: string,
  readText: ReadTextFile = readTextFile,
): Promise<Pick<AdapterPortInfo, "vendorId" | "productId" | "serialNumber">> {
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

export class WebSerialPortAdapter
  extends WebSerialEventTarget
  implements SerialPort
{
  private port: BunSerialPortRaw | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private dataListener: ((data: Uint8Array) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
  private nativePaused = false;
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
        this.dataListener = (data) => {
          if (this.port !== port || this.controller !== controller) return;

          if ((controller.desiredSize ?? 1) <= 0) {
            const pause = port.pause;
            if (typeof pause === "function" && !this.nativePaused) {
              pause.call(port);
              this.nativePaused = true;
            } else {
              this.failReadableBackpressure(port, controller);
              return;
            }
          }

          try {
            controller.enqueue(data);
          } catch {
            // Closing detaches this listener synchronously, but an event that
            // was already being dispatched may still reach this callback.
            return;
          }

          if ((controller.desiredSize ?? 1) <= 0 && !this.nativePaused) {
            const pause = port.pause;
            if (typeof pause === "function") {
              pause.call(port);
              this.nativePaused = true;
            }
          }
        };
        this.errorListener = (error) => {
          if (this.port !== port || this.controller !== controller) return;
          controller.error(error);
          this.controller = null;
          this.close().catch(() => {});
        };
        port.on("data", this.dataListener);
        port.on("error", this.errorListener);
      },
      pull: () => this.resumeNativePort(port),
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
    this.detachNativeListeners(port);

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

  private detachNativeListeners(port: BunSerialPortRaw): void {
    if (this.dataListener !== null) port.off("data", this.dataListener);
    if (this.errorListener !== null) port.off("error", this.errorListener);
    this.dataListener = null;
    this.errorListener = null;
    this.nativePaused = false;
  }

  private resumeNativePort(port: BunSerialPortRaw): void {
    if (this.port !== port || !this.nativePaused) return;
    this.nativePaused = false;
    port.resume?.();
  }

  private failReadableBackpressure(
    port: BunSerialPortRaw,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (this.port !== port || this.controller !== controller) return;
    controller.error(
      new Error(
        "serial input exceeded readable-stream capacity; the native backend cannot pause",
      ),
    );
    this.controller = null;
    void this.close();
  }

  async forget(): Promise<void> {
    await this.close();
  }
}

export class WebSerialAdapter extends WebSerialEventTarget implements Serial {
  private readonly ports = new Map<string, WebSerialPortAdapter>();

  constructor(
    private readonly os: NodeJS.Platform = platform(),
    private readonly list: () => Promise<AdapterPortInfo[]> = listPorts,
    private readonly linux: LinuxDiscoveryOperations = linuxDiscoveryOperations,
  ) {
    super();
  }

  private async listLinuxPorts(): Promise<AdapterPortInfo[]> {
    const ttys = await this.linux
      .readdir("/sys/class/tty")
      .then((names) => names.toSorted())
      .catch(() => []);
    const usbAttributes = new Map<
      string,
      ReturnType<LinuxDiscoveryOperations["readUsbAttributes"]>
    >();

    const ports = await mapWithConcurrency(
      ttys,
      LINUX_DISCOVERY_CONCURRENCY,
      async (name): Promise<AdapterPortInfo | undefined> => {
        try {
          const device = await this.linux.realpath(
            `/sys/class/tty/${name}/device`,
          );
          const subsystem = await this.linux
            .readlink(join(device, "subsystem"))
            .catch(() => "");
          const info: AdapterPortInfo = { path: `/dev/${name}` };

          if (subsystem.includes("usb")) {
            let attributes = usbAttributes.get(device);
            if (attributes === undefined) {
              attributes = this.linux.readUsbAttributes(device);
              usbAttributes.set(device, attributes);
            }
            Object.assign(info, await attributes);
          }
          return info;
        } catch {
          // Not a real device or no permission.
          return undefined;
        }
      },
    );
    return ports.filter((port) => port !== undefined);
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

    return ports.map(({ path, vendorId, productId, serialNumber }) => {
      let adapter = this.ports.get(path);
      if (!adapter) {
        adapter = new WebSerialPortAdapter(path, {
          path,
          id: serialNumber ?? path,
          serialNumber,
          usbVendorId: vendorId ? parseInt(vendorId, 16) : undefined,
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
