import { type BytesLike, toUint8Array } from "@v5x/cdc";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  SerialPortAdapter,
  SerialPortIO,
  SerialPortListAdapter,
} from "../index";
import type { SerialPortInfo } from "../ports";
import { V5_SERIAL_BAUDRATE } from "../ports";

type BunSerialPortCtor = new (options: {
  path: string;
  baudRate: number;
  autoOpen?: boolean;
}) => {
  open?: () => void | Promise<void>;
  close: () => void | Promise<void>;
  write: (data: Uint8Array) => void | Promise<void>;
  read?: (length?: number) => Uint8Array | Promise<Uint8Array | null> | null;
  readable?: ReadableStream<Uint8Array>;
  on?: (event: "data" | "error", listener: (data: Uint8Array) => void) => void;
  off?: (event: "data" | "error", listener: (data: Uint8Array) => void) => void;
};

export class BunSerialPortAdapter
  implements SerialPortAdapter, SerialPortListAdapter
{
  async list(): Promise<SerialPortInfo[]> {
    const mod = await import("bun-serialport");
    const list = await mod.list();
    return Promise.all(list.map(normalizePortInfo));
  }

  async open(
    port: SerialPortInfo | string,
    options: { baudRate?: number } = {},
  ): Promise<SerialPortIO> {
    const mod = await import("bun-serialport");
    const SerialPort = mod.SerialPort as BunSerialPortCtor;
    const path = typeof port === "string" ? port : port.path;
    const raw = new SerialPort({
      path,
      baudRate: options.baudRate ?? V5_SERIAL_BAUDRATE,
      autoOpen: false,
    });
    await raw.open?.();
    return new BunSerialPortIO(raw);
  }
}

class BunSerialPortIO implements SerialPortIO {
  private chunks: Uint8Array[] = [];
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private waiters: Array<() => void> = [];
  private readonly onData = (data: Uint8Array) => {
    this.chunks.push(data);
    this.flushWaiters();
  };

  constructor(private readonly port: InstanceType<BunSerialPortCtor>) {
    this.reader = port.readable?.getReader();
    port.on?.("data", this.onData);
  }

  async read(length?: number): Promise<Uint8Array> {
    if (this.port.read) {
      const value = await this.port.read(length);
      return value ?? new Uint8Array();
    }
    if (this.chunks.length > 0) return this.readFromChunks(length);
    if (!this.reader) {
      return new Promise((resolve) => {
        this.waiters.push(() => resolve(this.readFromChunks(length)));
      });
    }
    const result = await this.reader!.read();
    return result.value ?? new Uint8Array();
  }

  async write(data: BytesLike): Promise<void> {
    await this.port.write(toUint8Array(data));
  }

  async close(): Promise<void> {
    this.port.off?.("data", this.onData);
    this.reader?.releaseLock();
    await this.port.close();
  }

  private readFromChunks(length?: number): Uint8Array {
    if (length == null) return this.chunks.shift() ?? new Uint8Array();

    const out = new Uint8Array(Math.min(length, this.available));
    let offset = 0;
    while (offset < out.length) {
      const chunk = this.chunks[0]!;
      const take = Math.min(chunk.length, out.length - offset);
      out.set(chunk.subarray(0, take), offset);
      offset += take;

      if (take === chunk.length) {
        this.chunks.shift();
      } else {
        this.chunks[0] = chunk.subarray(take);
      }
    }
    return out;
  }

  private get available(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0 && this.chunks.length > 0) {
      this.waiters.shift()!();
    }
  }
}

async function normalizePortInfo(port: any): Promise<SerialPortInfo> {
  const info: SerialPortInfo = {
    path: port.path ?? port.portName ?? port.port_name,
    metadata: {
      vid: parseMaybeHex(port.vendorId ?? port.vid),
      pid: parseMaybeHex(port.productId ?? port.pid),
      interfaceNumber: port.interfaceNumber ?? port.interface,
    },
    raw: port,
  };

  if (process.platform === "linux") {
    await enrichLinuxSysfs(info);
  }

  return info;
}

function parseMaybeHex(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 16);
  return undefined;
}

async function enrichLinuxSysfs(port: SerialPortInfo): Promise<void> {
  const devicePath = await realpathSafe(`/sys/class/tty/${basename(port.path)}/device`);
  if (!devicePath) return;

  const usbDevice = await findUsbParent(devicePath);
  if (!usbDevice) return;

  const [manufacturer, serialNumber, vendorId, productId, product, interfaceNumber] = await Promise.all([
    readFileQuiet(join(usbDevice, "manufacturer")),
    readFileQuiet(join(usbDevice, "serial")),
    readFileQuiet(join(usbDevice, "idVendor")),
    readFileQuiet(join(usbDevice, "idProduct")),
    readFileQuiet(join(usbDevice, "product")),
    readFileQuiet(join(devicePath, "bInterfaceNumber")),
  ]);

  port.metadata = {
    ...port.metadata,
    vid: port.metadata?.vid ?? parseMaybeHex(vendorId),
    pid: port.metadata?.pid ?? parseMaybeHex(productId),
    interfaceNumber: port.metadata?.interfaceNumber ?? parseMaybeHex(interfaceNumber),
    manufacturer: port.metadata?.manufacturer ?? emptyToUndefined(manufacturer),
    product: port.metadata?.product ?? emptyToUndefined(product),
    serialNumber: port.metadata?.serialNumber ?? emptyToUndefined(serialNumber),
  };
}

async function findUsbParent(devicePath: string): Promise<string | undefined> {
  let current = devicePath;
  for (let i = 0; i < 10; i += 1) {
    if (await exists(join(current, "idVendor"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function realpathSafe(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function readFileQuiet(path: string): Promise<string> {
  try {
    return (await Bun.file(path).text()).trim();
  } catch {
    return "";
  }
}

function emptyToUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}
