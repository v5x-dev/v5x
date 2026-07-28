import { describe, expect, mock, test } from "bun:test";

class FakeBunSerialPort {
  static instances: FakeBunSerialPort[] = [];
  opened = 0;

  constructor(readonly options: { path: string; baudRate: number }) {
    FakeBunSerialPort.instances.push(this);
  }

  async open(): Promise<void> {
    this.opened++;
  }

  async close(): Promise<void> {}
  async write(): Promise<number> {
    return 0;
  }
  on(): void {}
  off(): void {}
}

await mock.module("bun-serialport", () => ({
  SerialPort: FakeBunSerialPort,
  list: async () => [
    { path: "/dev/cu.usbmodem01", vendorId: "2888", productId: "0501" },
  ],
}));

const { BUN_SERIALPORT_PLATFORMS, createBunSerialportBackend } =
  await import("./bun-serialport-backend.js");

describe("bun-serialport backend", () => {
  test("declares the platforms the native module ships for", () => {
    expect(createBunSerialportBackend().platforms).toEqual(
      BUN_SERIALPORT_PLATFORMS,
    );
    expect(BUN_SERIALPORT_PLATFORMS).toEqual(["darwin", "linux"]);
  });

  test("enumerates through the native list off Linux", async () => {
    const backend = createBunSerialportBackend({ platform: "darwin" });

    expect(await backend.list()).toEqual([
      { path: "/dev/cu.usbmodem01", vendorId: "2888", productId: "0501" },
    ]);
  });

  test("enumerates through sysfs on Linux so USB ids are known", async () => {
    const backend = createBunSerialportBackend({
      platform: "linux",
      linuxDiscovery: {
        readdir: async () => ["ttyACM0"],
        realpath: async () => "/sys/devices/usb1",
        readlink: async () => "/sys/bus/usb",
        readUsbAttributes: async () => ({
          vendorId: "2888",
          productId: "0501",
          serialNumber: "vex-1",
        }),
      },
    });

    expect(await backend.list()).toEqual([
      {
        path: "/dev/ttyACM0",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      },
    ]);
  });

  test("opens the native port before returning it", async () => {
    const backend = createBunSerialportBackend({ platform: "darwin" });

    await backend.open({ path: "/dev/cu.usbmodem01", baudRate: 115200 });

    const nativePort = FakeBunSerialPort.instances.at(-1)!;
    expect(nativePort.opened).toBe(1);
    expect(nativePort.options).toMatchObject({
      path: "/dev/cu.usbmodem01",
      baudRate: 115200,
      autoOpen: false,
    });
  });
});
