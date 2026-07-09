import { expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { V5SerialDevice, VexSerialError } from "@v5x/serial";
import type { Serial, SerialPort, SerialPortInfo } from "./adapter";
import {
  connectV5Device,
  matchesPortSelector,
  resolvePortSelector,
  selectSerialPort,
  withV5Device,
} from "./device";

class FakePort extends EventTarget implements SerialPort {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};
  readonly writable: WritableStream<Uint8Array> | null = null;
  opened = false;

  constructor(
    private readonly info: SerialPortInfo,
    readonly readable: ReadableStream<Uint8Array> | null = null,
  ) {
    super();
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  async forget(): Promise<void> {}
}

class FakeSerial extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  constructor(private readonly ports: SerialPort[]) {
    super();
  }

  async getPorts(): Promise<SerialPort[]> {
    return this.ports;
  }

  async requestPort(): Promise<SerialPort> {
    const port = this.ports.find((candidate) => candidate.readable === null);
    if (port) return port;
    throw new Error("No port found");
  }
}

test("resolves port selectors from options before V5X_PORT", () => {
  expect(
    resolvePortSelector(
      { port: " /dev/ttyACM1 " },
      { V5X_PORT: "/dev/ttyACM0" },
    ),
  ).toBe("/dev/ttyACM1");
  expect(resolvePortSelector({}, { V5X_PORT: " brain-a " })).toBe("brain-a");
  expect(resolvePortSelector({ port: " " }, { V5X_PORT: "" })).toBeUndefined();
});

test("rejects a bare --port option before selecting a device", () => {
  expect(() => resolvePortSelector({ port: true })).toThrow(
    "--port requires a value",
  );
});

test("matches fake serial ports by path, basename, id, or serial number", () => {
  const port = new FakePort({
    path: "/dev/ttyACM0",
    id: "brain-a",
    serialNumber: "vex-123",
  });

  expect(matchesPortSelector(port, "/dev/ttyACM0")).toBe(true);
  expect(matchesPortSelector(port, "ttyACM0")).toBe(true);
  expect(matchesPortSelector(port, "brain-a")).toBe(true);
  expect(matchesPortSelector(port, "vex-123")).toBe(true);
  expect(matchesPortSelector(port, "brain-b")).toBe(false);
});

test("selected serial adapter narrows fake ports by selector", async () => {
  const first = new FakePort({
    path: "/dev/ttyACM0",
    id: "brain-a",
    usbVendorId: 10376,
  });
  const second = new FakePort({
    path: "/dev/ttyACM1",
    id: "brain-b",
    usbVendorId: 10376,
  });
  const selected = selectSerialPort(new FakeSerial([first, second]), "brain-b");

  expect(await selected.getPorts()).toEqual([second]);
  expect(
    await selected.requestPort({ filters: [{ usbVendorId: 10376 }] }),
  ).toBe(second);
});

test("selected serial adapter honors filters without falling back", async () => {
  const nonVex = new FakePort({
    path: "/dev/ttyUSB0",
    id: "console",
    usbVendorId: 1234,
  });
  const vex = new FakePort({
    path: "/dev/ttyACM0",
    id: "brain-a",
    usbVendorId: 10376,
  });
  const selected = selectSerialPort(new FakeSerial([nonVex, vex]), "console");

  expect(await selected.getPorts()).toEqual([nonVex]);
  await expect(
    selected.requestPort({ filters: [{ usbVendorId: 10376 }] }),
  ).rejects.toThrow("No port found matching console");
});

test("disposes a device when connecting fails", async () => {
  let disposed = false;
  const device = {
    autoRefresh: true,
    connect: () => errAsync(new VexSerialError("io", "not connected")),
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  await expect(connectV5Device(device)).rejects.toThrow(
    "v5 device not connected",
  );
  expect(disposed).toBe(true);
});

test("disposes a device when connecting throws", async () => {
  let disposed = false;
  const device = {
    autoRefresh: true,
    connect: () => {
      throw new Error("serial failure");
    },
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  await expect(connectV5Device(device)).rejects.toThrow("serial failure");
  expect(disposed).toBe(true);
});

test("withV5Device disposes after a successful operation", async () => {
  let disposed = false;
  const fakeDevice = {
    autoRefresh: true,
    connect: () => okAsync(undefined),
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  const result = await withV5Device(async (connectedDevice) => {
    expect(connectedDevice.autoRefresh).toBe(false);
    return "done";
  }, fakeDevice);

  expect(result).toBe("done");
  expect(disposed).toBe(true);
});

test("withV5Device disposes after an operation failure", async () => {
  let disposed = false;
  const fakeDevice = {
    autoRefresh: true,
    connect: () => okAsync(undefined),
    dispose: async () => {
      disposed = true;
    },
  } as unknown as V5SerialDevice;

  await expect(
    withV5Device(async () => {
      throw new Error("operation failed");
    }, fakeDevice),
  ).rejects.toThrow("operation failed");
  expect(disposed).toBe(true);
});
