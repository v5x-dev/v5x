import { describe, expect, mock, test } from "bun:test";

class FakeNativePort {
  static instances: FakeNativePort[] = [];
  static closeError: Error | undefined;
  readonly writes: Uint8Array[] = [];
  pauses = 0;
  resumes = 0;
  closeGate: Promise<void> | undefined;
  private readonly listeners = new Map<
    string,
    Set<(value: Uint8Array | Error) => void>
  >();

  constructor(_options: object) {
    FakeNativePort.instances.push(this);
  }

  async open(): Promise<void> {}

  async close(): Promise<void> {
    await this.closeGate;
    if (FakeNativePort.closeError !== undefined) {
      const error = FakeNativePort.closeError;
      FakeNativePort.closeError = undefined;
      throw error;
    }
  }

  pause: (() => void) | undefined = () => {
    this.pauses++;
  };

  resume: (() => void) | undefined = () => {
    this.resumes++;
  };

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(data);
  }

  on(event: string, listener: (value: Uint8Array | Error) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (value: Uint8Array | Error) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value: Uint8Array | Error): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

await mock.module("bun-serialport", () => ({
  SerialPort: FakeNativePort,
  list: async () => [],
}));

const {
  LINUX_DISCOVERY_CONCURRENCY,
  WebSerialAdapter,
  readLinuxUsbDeviceAttributes,
} = await import("./adapter");

describe("WebSerialAdapter", () => {
  test("reads Linux USB vendor, product, and serial attributes", async () => {
    const files = new Map([
      ["/sys/devices/pci/idVendor", "2888\n"],
      ["/sys/devices/pci/idProduct", "0501\n"],
      ["/sys/devices/pci/serial", "vex-123\n"],
    ]);

    expect(
      await readLinuxUsbDeviceAttributes(
        "/sys/devices/pci/tty",
        async (path) => {
          const value = files.get(path);
          if (value === undefined) throw new Error(`missing ${path}`);
          return value;
        },
      ),
    ).toEqual({
      vendorId: "2888",
      productId: "0501",
      serialNumber: "vex-123",
    });
  });

  test("keeps Linux USB serial unknown when the attribute is absent", async () => {
    const files = new Map([
      ["/sys/devices/pci/tty/idVendor", "2888\n"],
      ["/sys/devices/pci/tty/idProduct", "0501\n"],
    ]);

    expect(
      await readLinuxUsbDeviceAttributes(
        "/sys/devices/pci/tty",
        async (path) => {
          const value = files.get(path);
          if (value === undefined) throw new Error(`missing ${path}`);
          return value;
        },
      ),
    ).toEqual({
      vendorId: "2888",
      productId: "0501",
      serialNumber: undefined,
    });
  });

  test("discovers a large Linux TTY set with bounded concurrency and stable ordering", async () => {
    const names = Array.from(
      { length: 100 },
      (_, index) => `ttyACM${String(99 - index).padStart(3, "0")}`,
    );
    names.push("denied");
    let active = 0;
    let maximumActive = 0;
    let attributeReads = 0;

    const adapter = new WebSerialAdapter("linux", async () => [], {
      readdir: async () => names,
      realpath: async (path) => {
        if (path.endsWith("/denied/device")) throw new Error("EACCES");
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(1);
        active--;
        const index = Number(path.match(/ttyACM(\d+)/)?.[1] ?? 0);
        return `/sys/devices/usb-${index % 10}`;
      },
      readlink: async () => "/sys/bus/usb",
      readUsbAttributes: async () => {
        attributeReads++;
        await Bun.sleep(1);
        return { vendorId: "2888", productId: "0501" };
      },
    });

    const ports = await adapter.getPorts();

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(LINUX_DISCOVERY_CONCURRENCY);
    expect(attributeReads).toBe(10);
    expect(ports.map((port) => port.getInfo().path)).toEqual(
      names
        .filter((name) => name !== "denied")
        .toSorted()
        .map((name) => `/dev/${name}`),
    );
  });

  test("reuses port objects so open state is shared", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/ttyACM0", vendorId: "2888", productId: "0501" },
    ]);

    const first = await adapter.getPorts();
    const second = await adapter.getPorts();

    expect(second[0]).toBe(first[0]);
    expect(first[0]?.getInfo()).toEqual({
      path: "/dev/ttyACM0",
      id: "/dev/ttyACM0",
      usbVendorId: 10376,
      usbProductId: 1281,
    });
  });

  test("keeps USB identifiers unknown when macOS omits them", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.usbmodem01" },
    ]);

    const ports = await adapter.getPorts();

    expect(ports[0]?.getInfo()).toEqual({
      path: "/dev/cu.usbmodem01",
      id: "/dev/cu.usbmodem01",
      usbVendorId: undefined,
      usbProductId: undefined,
    });
    await expect(
      adapter.requestPort({ filters: [{ usbVendorId: 10376 }] }),
    ).rejects.toThrow("No port found matching filters");
  });

  test("reports Windows as needing a different serial backend", async () => {
    const adapter = new WebSerialAdapter("win32", async () => []);
    await expect(adapter.getPorts()).rejects.toThrow(
      "needs a Windows-capable serial backend",
    );
  });

  test("models closed, open, errored, and reopened stream states", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.test", vendorId: "2888", productId: "0501" },
    ]);
    const port = (await adapter.getPorts())[0]!;

    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    expect(port.readable).not.toBeNull();
    expect(port.writable).not.toBeNull();

    const nativePort = FakeNativePort.instances.at(-1)!;
    const reader = port.readable!.getReader();
    nativePort.emit("data", new Uint8Array([1, 2, 3]));
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    reader.releaseLock();

    const writer = port.writable!.getWriter();
    await writer.write(new Uint8Array([4, 5]));
    writer.releaseLock();
    expect(nativePort.writes).toEqual([new Uint8Array([4, 5])]);

    await port.close();
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    expect(port.readable).not.toBeNull();
    await port.close();
  });

  test("native close rejection still clears adapter state", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.error" },
    ]);
    const port = (await adapter.getPorts())[0]!;
    await port.open({ baudRate: 115200 });
    FakeNativePort.closeError = new Error("native close failed");

    await expect(port.close()).rejects.toThrow("native close failed");
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    await port.open({ baudRate: 115200 });
    await port.close();
  });

  test("native data and error events are ignored after cancellation", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.cancel" },
    ]);
    const port = (await adapter.getPorts())[0]!;
    await port.open({ baudRate: 115200 });
    const nativePort = FakeNativePort.instances.at(-1)!;

    expect(nativePort.listenerCount("data")).toBe(1);
    expect(nativePort.listenerCount("error")).toBe(1);
    await port.readable!.cancel();

    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    expect(nativePort.listenerCount("data")).toBe(0);
    expect(nativePort.listenerCount("error")).toBe(0);

    nativePort.emit("data", new Uint8Array([9]));
    nativePort.emit("error", new Error("late native error"));

    await port.open({ baudRate: 115200 });
    await port.close();
  });

  test("detaches native listeners before awaiting close", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.race" },
    ]);
    const port = (await adapter.getPorts())[0]!;
    await port.open({ baudRate: 115200 });
    const nativePort = FakeNativePort.instances.at(-1)!;
    let finishClose: (() => void) | undefined;
    nativePort.closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });

    const closing = port.close();
    expect(nativePort.listenerCount("data")).toBe(0);
    expect(nativePort.listenerCount("error")).toBe(0);
    expect(() => nativePort.emit("data", new Uint8Array([9]))).not.toThrow();
    expect(() =>
      nativePort.emit("error", new Error("late error")),
    ).not.toThrow();

    finishClose?.();
    await closing;
  });

  test("pauses native reads while the readable stream is backpressured", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.backpressure" },
    ]);
    const port = (await adapter.getPorts())[0]!;
    await port.open({ baudRate: 115200 });
    const nativePort = FakeNativePort.instances.at(-1)!;
    const reader = port.readable!.getReader();

    nativePort.emit("data", new Uint8Array([1]));
    expect(nativePort.pauses).toBe(1);
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    await Bun.sleep(0);
    expect(nativePort.resumes).toBe(1);

    reader.releaseLock();
    await port.close();
  });

  test("fails closed on overflow when native reads cannot be paused", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.bounded" },
    ]);
    const port = (await adapter.getPorts())[0]!;
    await port.open({ baudRate: 115200 });
    const nativePort = FakeNativePort.instances.at(-1)!;
    nativePort.pause = undefined;
    nativePort.resume = undefined;
    const reader = port.readable!.getReader();

    nativePort.emit("data", new Uint8Array([1]));
    nativePort.emit("data", new Uint8Array([2]));

    await expect(reader.read()).rejects.toThrow("readable-stream capacity");
    await Bun.sleep(0);
    expect(port.readable).toBeNull();
    expect(port.writable).toBeNull();
    expect(nativePort.listenerCount("data")).toBe(0);
  });
});
