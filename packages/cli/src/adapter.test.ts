import { describe, expect, mock, test } from "bun:test";

class FakeNativePort {
  static instances: FakeNativePort[] = [];
  static closeError: Error | undefined;
  readonly writes: Uint8Array[] = [];
  private readonly listeners = new Map<
    string,
    Set<(value: Uint8Array | Error) => void>
  >();

  constructor(_options: object) {
    FakeNativePort.instances.push(this);
  }

  async open(): Promise<void> {}

  async close(): Promise<void> {
    if (FakeNativePort.closeError !== undefined) {
      const error = FakeNativePort.closeError;
      FakeNativePort.closeError = undefined;
      throw error;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(data);
  }

  on(event: string, listener: (value: Uint8Array | Error) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
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

const { WebSerialAdapter } = await import("./adapter");

describe("WebSerialAdapter", () => {
  test("reuses port objects so open state is shared", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/ttyACM0", vendorId: "2888", productId: "0501" },
    ]);

    const first = await adapter.getPorts();
    const second = await adapter.getPorts();

    expect(second[0]).toBe(first[0]);
    expect(first[0]?.getInfo()).toEqual({
      usbVendorId: 10376,
      usbProductId: 1281,
    });
  });

  test("allows protocol probing when macOS omits USB identifiers", async () => {
    const adapter = new WebSerialAdapter("darwin", async () => [
      { path: "/dev/cu.usbmodem01" },
    ]);

    const ports = await adapter.getPorts();

    expect(ports[0]?.getInfo()).toEqual({
      usbVendorId: 10376,
      usbProductId: undefined,
    });
    expect(
      await adapter.requestPort({ filters: [{ usbVendorId: 10376 }] }),
    ).toBe(ports[0]!);
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
});
