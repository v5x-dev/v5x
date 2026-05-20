import { type BytesLike, toUint8Array } from "@v5x/cdc";
import type {
  SerialPortAdapter,
  SerialPortIO,
  SerialPortListAdapter,
} from "../index";
import type { SerialPortInfo } from "../ports";
import { V5_SERIAL_BAUDRATE } from "../ports";

type WebSerialPort = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
};

type WebNavigator = Navigator & {
  serial?: {
    getPorts(): Promise<WebSerialPort[]>;
    requestPort(options?: unknown): Promise<WebSerialPort>;
  };
};

export class WebSerialAdapter
  implements SerialPortAdapter<WebSerialPort>, SerialPortListAdapter
{
  constructor(
    private readonly serial = (globalThis.navigator as WebNavigator | undefined)
      ?.serial,
  ) {}

  async requestPort(options?: unknown): Promise<WebSerialPort> {
    if (!this.serial)
      throw new Error("Web Serial is not available in this environment");
    return this.serial.requestPort(options);
  }

  async list(): Promise<SerialPortInfo[]> {
    if (!this.serial)
      throw new Error("Web Serial is not available in this environment");
    const ports = await this.serial.getPorts();
    return ports.map((port, index) => {
      const info = port.getInfo();
      return {
        path: `web-serial:${index}`,
        metadata: {
          vid: info.usbVendorId,
          pid: info.usbProductId,
        },
        raw: port,
      };
    });
  }

  async open(
    port: WebSerialPort | SerialPortInfo,
    options: { baudRate?: number } = {},
  ): Promise<SerialPortIO> {
    const raw = isSerialPortInfo(port)
      ? (port.raw as WebSerialPort | undefined)
      : port;
    if (!raw)
      throw new Error(
        "WebSerialAdapter.open requires a Web Serial port object",
      );
    await raw.open({ baudRate: options.baudRate ?? V5_SERIAL_BAUDRATE });
    return new WebSerialPortIO(raw);
  }
}

class WebSerialPortIO implements SerialPortIO {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private pending = new Uint8Array();

  constructor(private readonly port: WebSerialPort) {
    if (!port.readable || !port.writable)
      throw new Error("Web Serial port did not expose streams");
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
  }

  async read(length?: number): Promise<Uint8Array> {
    if (length != null && this.pending.length >= length)
      return this.take(length);
    const result = await this.reader!.read();
    if (result.done) return new Uint8Array();
    const chunk = new Uint8Array(new ArrayBuffer(result.value.byteLength));
    chunk.set(result.value);
    this.pending = concat(
      this.pending,
      chunk,
    ) as unknown as Uint8Array<ArrayBuffer>;
    return length == null
      ? this.take(this.pending.length)
      : this.take(Math.min(length, this.pending.length));
  }

  async write(data: BytesLike): Promise<void> {
    await this.writer!.write(toUint8Array(data));
  }

  async close(): Promise<void> {
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    await this.port.close();
  }

  private take(length: number): Uint8Array {
    const out = this.pending.subarray(0, length);
    this.pending = this.pending.subarray(
      length,
    ) as unknown as Uint8Array<ArrayBuffer>;
    return out;
  }
}

function isSerialPortInfo(
  port: WebSerialPort | SerialPortInfo,
): port is SerialPortInfo {
  return "path" in port;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length));
  out.set(a);
  out.set(b, a.length);
  return out;
}
