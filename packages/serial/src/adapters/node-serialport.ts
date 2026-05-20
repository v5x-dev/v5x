import { type BytesLike, toUint8Array } from "@v5x/cdc";
import type {
  SerialPortAdapter,
  SerialPortIO,
  SerialPortListAdapter,
} from "../index";
import type { SerialPortInfo } from "../ports";
import { V5_SERIAL_BAUDRATE } from "../ports";

export class NodeSerialPortAdapter
  implements SerialPortAdapter, SerialPortListAdapter
{
  async list(): Promise<SerialPortInfo[]> {
    const mod = await import("serialport");
    const list = await mod.SerialPort.list();
    return list.map(normalizePortInfo);
  }

  async open(
    port: SerialPortInfo | string,
    options: { baudRate?: number } = {},
  ): Promise<SerialPortIO> {
    const mod = await import("serialport");
    const path = typeof port === "string" ? port : port.path;
    const raw = new mod.SerialPort({
      path,
      baudRate: options.baudRate ?? V5_SERIAL_BAUDRATE,
      autoOpen: false,
    });
    await new Promise<void>((resolve, reject) =>
      raw.open((error: Error | null | undefined) =>
        error ? reject(error) : resolve(),
      ),
    );
    return new NodeSerialPortIO(raw);
  }
}

class NodeSerialPortIO implements SerialPortIO {
  private chunks: Uint8Array[] = [];
  private waiters: Array<() => void> = [];

  constructor(private readonly port: any) {
    port.on("data", (chunk: Buffer) => {
      this.chunks.push(
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
      for (const waiter of this.waiters.splice(0)) waiter();
    });
  }

  async read(length?: number): Promise<Uint8Array> {
    while (this.available < (length ?? 1)) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    return this.take(length ?? this.available);
  }

  async write(data: BytesLike): Promise<void> {
    const bytes = toUint8Array(data);
    await new Promise<void>((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (error: Error | null | undefined) => {
        if (error) reject(error);
        else
          this.port.drain((drainError: Error | null | undefined) =>
            drainError ? reject(drainError) : resolve(),
          );
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.port.close((error: Error | null | undefined) =>
        error ? reject(error) : resolve(),
      ),
    );
  }

  private get available(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  private take(length: number): Uint8Array {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.chunks[0]!;
      const used = Math.min(chunk.length, length - offset);
      out.set(chunk.subarray(0, used), offset);
      offset += used;
      if (used === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(used);
    }
    return out;
  }
}

function normalizePortInfo(port: any): SerialPortInfo {
  return {
    path: port.path,
    metadata: {
      vid: parseMaybeHex(port.vendorId),
      pid: parseMaybeHex(port.productId),
      interfaceNumber: port.interfaceNumber,
    },
    raw: port,
  };
}

function parseMaybeHex(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 16);
  return undefined;
}
