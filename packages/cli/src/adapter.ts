import { SerialPort as BunSerialPortRaw, list } from "bun-serialport";
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
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
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

interface AdapterPortInfo {
  path: string;
  vendorId?: string;
  productId?: string;
}

class WebSerialPortAdapter extends EventTarget implements SerialPort {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  private _port: BunSerialPortRaw | null = null;
  private _path: string;
  private _info: SerialPortInfo;
  private _readable: ReadableStream<Uint8Array> | null = null;
  private _writable: WritableStream<Uint8Array> | null = null;
  private _readerController: ReadableStreamDefaultController<Uint8Array> | null =
    null;

  constructor(path: string, info: SerialPortInfo) {
    super();
    this._path = path;
    this._info = info;
  }

  get readable(): ReadableStream<Uint8Array> {
    return this._readable as unknown as ReadableStream<Uint8Array>;
  }
  get writable(): WritableStream<Uint8Array> {
    return this._writable as unknown as WritableStream<Uint8Array>;
  }

  getInfo(): SerialPortInfo {
    return this._info;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this._port) throw new Error("Port already open");

    this._port = new BunSerialPortRaw({
      path: this._path,
      baudRate: options.baudRate,
      autoOpen: false,
    });

    await this._port.open();

    this._readable = new ReadableStream({
      start: (controller) => {
        this._readerController = controller;
        this._port?.on("data", (data: Uint8Array) => {
          controller.enqueue(data);
        });
        this._port?.on("error", (err) => {
          controller.error(err);
          this.close().catch(() => {});
        });
      },
      cancel: () => {
        this.close();
      },
    });

    this._writable = new WritableStream({
      write: async (chunk) => {
        if (!this._port) throw new Error("Port closed");
        await this._port.write(chunk);
      },
      close: async () => {
        await this.close();
      },
    });
  }

  async close(): Promise<void> {
    if (!this._port) return;

    const port = this._port;
    this._port = null;

    if (this._readerController) {
      try {
        this._readerController.close();
      } catch (e) {}
      this._readerController = null;
    }

    await port.close();

    try {
      port.removeAllListeners?.();
    } catch (e) {}
    this._readable = null;
    this._writable = null;

    this.dispatchEvent(new Event("disconnect"));
  }

  async forget(): Promise<void> {
    await this.close();
  }
}

class WebSerialAdapter extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  private async _listPortsLinux() {
    const ttys = await readdir("/sys/class/tty").catch(() => []);
    const ports: AdapterPortInfo[] = [];

    for (const name of ttys) {
      const sysPath = `/sys/class/tty/${name}`;
      const devicePath = join(sysPath, "device");

      try {
        const realDevicePath = await realpath(devicePath);
        const subsystem = await readlink(
          join(realDevicePath, "subsystem"),
        ).catch(() => "");

        const info: AdapterPortInfo = { path: `/dev/${name}` };

        if (subsystem.includes("usb")) {
          let current = realDevicePath;
          for (let i = 0; i < 5; i++) {
            try {
              const vendorId = await Bun.file(join(current, "idVendor"))
                .text()
                .then((t) => t.trim());
              const productId = await Bun.file(join(current, "idProduct"))
                .text()
                .then((t) => t.trim());
              info.vendorId = vendorId;
              info.productId = productId;
              break;
            } catch (e) {
              current = join(current, "..");
            }
          }
        }
        ports.push(info);
      } catch (e) {
        // Not a real device or no permission
      }
    }
    return ports;
  }

  async getPorts(): Promise<SerialPort[]> {
    const ports =
      platform() === "linux" ? await this._listPortsLinux() : await list();

    return ports.map(
      (p) =>
        new WebSerialPortAdapter(p.path, {
          usbVendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
          usbProductId: p.productId ? parseInt(p.productId, 16) : undefined,
        }),
    );
  }

  async requestPort(options?: {
    filters?: SerialPortFilter[];
  }): Promise<SerialPort> {
    const ports = await this.getPorts();
    if (options?.filters && options.filters.length > 0) {
      const filtered = ports.filter((p) => {
        const info = p.getInfo();
        return options.filters?.some(
          (f) =>
            (f.usbVendorId === undefined ||
              f.usbVendorId === info.usbVendorId) &&
            (f.usbProductId === undefined ||
              f.usbProductId === info.usbProductId),
        );
      });
      const port = filtered[0];
      if (port) return port;
      throw new Error("No port found matching filters");
    }
    const port = ports[0];
    if (port) return port;
    throw new Error("No port found");
  }
}

export const serial = new WebSerialAdapter();
