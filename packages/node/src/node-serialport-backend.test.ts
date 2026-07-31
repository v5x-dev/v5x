import { describe, expect, mock, test } from "bun:test";

class FakeSerialPort {
  static readonly instances: FakeSerialPort[] = [];
  static async list() {
    return [
      {
        path: "/dev/ttyACM0",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      },
    ];
  }

  opened = 0;
  written: Uint8Array[] = [];
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();

  constructor(readonly options: Record<string, unknown>) {
    FakeSerialPort.instances.push(this);
  }

  open(callback: (error: Error | null) => void): void {
    this.opened++;
    callback(null);
  }

  close(callback: (error: Error | null) => void): void {
    callback(null);
  }

  write(data: Uint8Array, callback: (error: Error | null) => void): boolean {
    this.written.push(data.slice());
    callback(null);
    return true;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  on(event: string, listener: (value: unknown) => void): this {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return this;
  }

  off(event: string, listener: (value: unknown) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }
}

await mock.module("serialport", () => ({ SerialPort: FakeSerialPort }));

const { NODE_SERIALPORT_PLATFORMS, createNodeSerialportBackend } =
  await import("./node-serialport-backend.js");

describe("Node serialport backend", () => {
  test("declares its supported operating systems", () => {
    expect(NODE_SERIALPORT_PLATFORMS).toEqual(["darwin", "linux", "win32"]);
    expect(createNodeSerialportBackend().platforms).toEqual(
      NODE_SERIALPORT_PLATFORMS,
    );
  });

  test("lists ports through serialport off Windows", async () => {
    const backend = createNodeSerialportBackend({ platform: "linux" });

    expect(await backend.list()).toEqual([
      {
        path: "/dev/ttyACM0",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      },
    ]);
  });

  test("uses shared Windows discovery without loading Bun FFI", async () => {
    const backend = createNodeSerialportBackend({
      platform: "win32",
      windowsDiscovery: {
        readSerialComm: async () => "    \\Device\\USBSER000    REG_SZ    COM3",
        readUsbPortNames: async () =>
          [
            "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2888&PID_0501\\vex-1\\Device Parameters",
            "    PortName    REG_SZ    COM3",
          ].join("\r\n"),
      },
    });

    expect(await backend.list()).toEqual([
      {
        path: "COM3",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      },
    ]);
  });

  test("opens and adapts the Node serial port lifecycle", async () => {
    const backend = createNodeSerialportBackend({ platform: "linux" });
    const port = await backend.open({
      path: "/dev/ttyACM0",
      baudRate: 115200,
    });

    const nativePort = FakeSerialPort.instances.at(-1)!;
    expect(nativePort.opened).toBe(1);
    expect(nativePort.options).toEqual({
      path: "/dev/ttyACM0",
      baudRate: 115200,
      autoOpen: false,
    });

    await port.write(new Uint8Array([1, 2, 3]));
    await port.close();
    expect(nativePort.written).toEqual([new Uint8Array([1, 2, 3])]);
  });
});
