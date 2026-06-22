import { afterEach, describe, expect, test } from "bun:test";
import { FileVendor } from "./Vex";
import {
  V5SerialDevice,
  downloadFileFromInternet,
  sleepUntilAsync,
} from "./VexDevice";
import { V5SerialConnection } from "./VexConnection";

const devices: V5SerialDevice[] = [];
const serial = {
  getPorts: async () => [],
} as unknown as Serial;

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

describe("sleepUntilAsync", () => {
  test("waits between attempts and propagates predicate failures", async () => {
    let attempts = 0;
    expect(await sleepUntilAsync(async () => ++attempts === 2, 100, 10)).toBe(
      true,
    );
    expect(attempts).toBe(2);
    expect(
      sleepUntilAsync(async () => {
        throw new Error("predicate failed");
      }, 100),
    ).rejects.toThrow("predicate failed");
  });
});

test("downloadFileFromInternet rejects HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  const mockedFetch = Object.assign(
    async () => new Response("missing", { status: 404 }),
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = mockedFetch;
  try {
    expect(
      downloadFileFromInternet("https://example.test/file"),
    ).rejects.toThrow("404");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful file reads resume automatic refresh", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const connection = {
    isConnected: true,
    downloadFileToHost: async () => new Uint8Array([1, 2, 3]),
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.connection = connection;

  expect(
    await device.brain.readFile({ filename: "test", vendor: FileVendor.USER }),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(device.state._isFileTransferring).toBe(false);
});

test("connect opens and retains a supplied connection", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let opened = false;
  let connected = false;
  const connection = {
    get isConnected() {
      return connected;
    },
    open: async () => {
      opened = true;
      connected = true;
      return true;
    },
    query1: async () => ({}),
    on: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = async () => true;

  expect(await device.connect(connection)).toBe(true);
  expect(opened).toBe(true);
  expect(device.connection).toBe(connection);
});

test("explicit disconnect does not trigger automatic reconnect", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let disconnected: (() => void) | undefined;
  let reconnects = 0;
  const connection = {
    isConnected: true,
    query1: async () => ({}),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    close: async () => disconnected?.(),
  } as unknown as V5SerialConnection;
  device.refresh = async () => true;
  device.reconnect = async () => {
    reconnects++;
    return true;
  };

  await device.connect(connection);
  await device.disconnect();
  expect(reconnects).toBe(0);
});

test("reconnect clears its guard when port discovery throws", async () => {
  class InspectableDevice extends V5SerialDevice {
    get isReconnecting() {
      return this._isReconnecting;
    }
  }
  const failingSerial = {
    getPorts: async () => {
      throw new Error("port discovery failed");
    },
  } as unknown as Serial;
  const device = new InspectableDevice(failingSerial);
  devices.push(device);

  await expect(device.reconnect(100)).rejects.toThrow("port discovery failed");
  expect(device.isReconnecting).toBe(false);
});
