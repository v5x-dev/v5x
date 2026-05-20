import {
  type BytesLike,
  type CdcCommand,
  DecodeError,
  REPLY_HEADER,
  UserDataPacket,
  toUint8Array,
} from "@v5x/cdc";
import {
  V5_SERIAL_BAUDRATE,
  findDevicesFromPorts,
  type SerialPortAdapter,
  type SerialPortListAdapter,
  type VexSerialDevice,
} from "./ports";

export {
  VEX_USB_VID,
  V5_BRAIN_USB_PID,
  EXP_BRAIN_USB_PID,
  V5_CONTROLLER_USB_PID,
  AIR_HORNET_USB_PID,
  AIR_CONTROLLER_USB_PID,
  AIM_USB_PID,
  AIV_USB_PID,
  V5_SERIAL_BAUDRATE,
  type SerialPortInfo,
  type SerialPortAdapter,
  type SerialPortListAdapter,
  type SerialPortMetadata,
  type VexSerialPort,
  type VexSerialDevice,
  VexSerialPortType,
  findDevicesFromPorts,
  filterVexPorts,
} from "./ports";
export { WebSerialAdapter } from "./adapters/web-serial";
export { BunSerialPortAdapter } from "./adapters/bun-serialport";
export { NodeSerialPortAdapter } from "./adapters/node-serialport";

export type ConnectionType = "wired" | "controller" | "bluetooth";

export interface SerialPortIO {
  read(length?: number): Promise<Uint8Array>;
  write(data: BytesLike): Promise<void>;
  close(): Promise<void>;
}

export interface SerialConnectionOptions {
  system: SerialPortIO;
  user?: SerialPortIO;
  packetTimeoutMs?: number;
}

class RawPacket {
  used = false;
  readonly timestamp = Date.now();
  constructor(readonly bytes: Uint8Array) {}
  isObsolete(timeoutMs = 2000): boolean {
    return this.used || Date.now() - this.timestamp > timeoutMs;
  }
}

export class SerialTimeoutError extends Error {
  constructor(message = "Packet timeout") {
    super(message);
    this.name = "SerialTimeoutError";
  }
}

export class SerialConnection {
  private incomingPackets: RawPacket[] = [];
  private readonly packetTimeoutMs: number;

  constructor(private readonly options: SerialConnectionOptions) {
    this.packetTimeoutMs = options.packetTimeoutMs ?? 2000;
  }

  get connectionType(): ConnectionType {
    return this.options.user ? "wired" : "controller";
  }

  async close(): Promise<void> {
    await Promise.all([
      this.options.system.close(),
      this.options.user?.close(),
    ]);
  }

  async send(packet: CdcCommand): Promise<void> {
    await this.options.system.write(packet.encode());
  }

  async recv<Reply>(
    packet: CdcCommand<Reply>,
    timeoutMs = this.packetTimeoutMs,
  ): Promise<Reply> {
    if (!packet.decodeReply) {
      throw new TypeError("Packet does not expose a decodeReply method");
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const raw of this.incomingPackets) {
        if (raw.used) continue;
        try {
          const reply = packet.decodeReply(raw.bytes);
          raw.used = true;
          this.trimPackets();
          return reply;
        } catch (error) {
          if (error instanceof DecodeError && error.kind === "UnexpectedByte")
            continue;
          if (error instanceof DecodeError && error.kind === "InvalidHeader")
            continue;
          raw.used = true;
          throw error;
        }
      }

      this.trimPackets();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SerialTimeoutError();
      await withTimeout(this.receiveOnePacket(), remaining);
    }
  }

  async handshake<Reply>(
    packet: CdcCommand<Reply>,
    timeoutMs = 1000,
    retries = 0,
  ): Promise<Reply> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await this.send(packet);
      try {
        return await this.recv(packet, timeoutMs);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async readUser(length = 4096): Promise<Uint8Array> {
    if (this.options.user) return this.options.user.read(length);

    for (;;) {
      const reply = await this.handshake(new UserDataPacket(1), 100, 1);
      if (typeof reply === "object" && "data" in reply && reply.data) {
        return new TextEncoder().encode(reply.data).subarray(0, length);
      }
    }
  }

  async writeUser(data: BytesLike): Promise<number> {
    const bytes = toUint8Array(data);
    if (this.options.user) {
      await this.options.user.write(bytes);
      return bytes.length;
    }

    const decoder = new TextDecoder();
    for (let offset = 0; offset < bytes.length; offset += 224) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + 224, bytes.length),
      );
      await this.handshake(
        new UserDataPacket(2, decoder.decode(chunk)),
        100,
        1,
      );
    }
    return bytes.length;
  }

  private async receiveOnePacket(): Promise<void> {
    const header = await readExactly(this.options.system, 2);
    if (header[0] !== REPLY_HEADER[0] || header[1] !== REPLY_HEADER[1]) return;

    const packet = [...header, ...(await readExactly(this.options.system, 1))];
    const firstSizeByte = (await readExactly(this.options.system, 1))[0]!;
    let size: number;
    if ((firstSizeByte & 0x80) !== 0) {
      const secondSizeByte = (await readExactly(this.options.system, 1))[0]!;
      packet.push(firstSizeByte, secondSizeByte);
      size = ((firstSizeByte & 0x7f) << 8) | secondSizeByte;
    } else {
      packet.push(firstSizeByte);
      size = firstSizeByte;
    }

    packet.push(...(await readExactly(this.options.system, size)));
    this.incomingPackets.push(new RawPacket(Uint8Array.from(packet)));
  }

  private trimPackets(): void {
    this.incomingPackets = this.incomingPackets.filter(
      (packet) => !packet.isObsolete(this.packetTimeoutMs),
    );
  }
}

export async function findSerialDevices(adapter: SerialPortListAdapter) {
  return findDevicesFromPorts(await adapter.list());
}

export async function connectSerialDevice(
  adapter: SerialPortAdapter,
  device: VexSerialDevice,
  options: { timeoutMs?: number } = {},
): Promise<SerialConnection> {
  const system = await adapter.open(device.systemPort.info, {
    baudRate: V5_SERIAL_BAUDRATE,
    timeoutMs: options.timeoutMs,
  });
  const user = device.userPort
    ? await adapter.open(device.userPort.info, {
        baudRate: V5_SERIAL_BAUDRATE,
        timeoutMs: options.timeoutMs,
      })
    : undefined;
  return new SerialConnection({
    system,
    user,
    packetTimeoutMs: options.timeoutMs,
  });
}

export async function readExactly(
  port: SerialPortIO,
  length: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const chunk = await port.read(length - offset);
    if (chunk.length === 0) continue;
    out.set(chunk.subarray(0, length - offset), offset);
    offset += Math.min(chunk.length, length - offset);
  }
  return out;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SerialTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
