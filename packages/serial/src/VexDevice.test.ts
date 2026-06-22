import { afterEach, describe, expect, test } from "bun:test";
import { FileVendor, RadioChannelType } from "./Vex";
import {
  V5Radio,
  V5SerialDevice,
  downloadFileFromInternet,
  sleepUntilAsync,
} from "./VexDevice";
import { V5SerialConnection } from "./VexConnection";
import { type ProgramIniConfig } from "./VexIniConfig";

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

test("firmware uploads reject unsafe version paths", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;

  await expect(
    device.brain.uploadFirmware("https://example.test/", "../firmware"),
  ).rejects.toThrow("invalid VEXos version");
});

test("firmware uploads propagate download failures", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("missing", { status: 404 }),
    { preconnect: originalFetch.preconnect },
  );

  try {
    await expect(
      device.brain.uploadFirmware("https://example.test/", "valid-version"),
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

test("concurrent file operations keep automatic refresh paused", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let resolveFirst = (_value: Uint8Array): void => {};
  let resolveSecond = (_value: Uint8Array): void => {};
  let calls = 0;
  const first = new Promise<Uint8Array>((resolve) => (resolveFirst = resolve));
  const second = new Promise<Uint8Array>(
    (resolve) => (resolveSecond = resolve),
  );
  device.connection = {
    isConnected: true,
    downloadFileToHost: async () => (calls++ === 0 ? first : second),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const firstRead = device.brain.readFile("first");
  const secondRead = device.brain.readFile("second");
  expect(device.state._isFileTransferring).toBe(true);

  resolveFirst(new Uint8Array([1]));
  await firstRead;
  expect(device.state._isFileTransferring).toBe(true);

  resolveSecond(new Uint8Array([2]));
  await secondRead;
  expect(device.state._isFileTransferring).toBe(false);
});

test("state-changing methods wait for acknowledgement before updating state", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const loadedSlots: number[] = [];
  let stopped = false;
  device.connection = {
    isConnected: true,
    setMatchMode: async () => ({}),
    loadProgram: async (slot: number) => {
      loadedSlots.push(slot);
      return {};
    },
    stopProgram: async () => {
      stopped = true;
      return {};
    },
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(await device.setMatchMode("driver")).toBe(true);
  expect(device.matchMode).toBe("driver");
  expect(await device.brain.setActiveProgram(2)).toBe(true);
  expect(device.brain.activeProgram).toBe(2);
  expect(loadedSlots).toEqual([2]);
  expect(await device.brain.setActiveProgram(0)).toBe(true);
  expect(device.brain.activeProgram).toBe(0);
  expect(stopped).toBe(true);
});

test("state-changing methods report a disconnected device", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);

  expect(await device.setMatchMode("driver")).toBe(false);
  expect(await device.brain.setActiveProgram(1)).toBe(false);
});

test("controller uploads restore the pit channel after upload failure", async () => {
  const channels: RadioChannelType[] = [];
  class ControllerDevice extends V5SerialDevice {
    override get isV5Controller(): boolean {
      return true;
    }

    override get radio(): V5Radio {
      return {
        changeChannel: async (channel: RadioChannelType) => {
          channels.push(channel);
          return true;
        },
      } as unknown as V5Radio;
    }
  }

  const device = new ControllerDevice(serial);
  devices.push(device);
  device.refresh = async () => true;
  device.connection = {
    isConnected: true,
    getSystemStatus: async () => ({}),
    uploadProgramToDevice: async () => false,
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(
    await device.brain.uploadProgram(
      {} as ProgramIniConfig,
      new Uint8Array([1]),
      undefined,
      () => {},
    ),
  ).toBe(false);
  expect(channels).toEqual([RadioChannelType.DOWNLOAD, RadioChannelType.PIT]);
});

test("automatic refresh failures are emitted instead of left unhandled", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = async () => {
    throw new Error("refresh failed");
  };

  const emitted = new Promise<unknown>((resolve) => {
    device.on("error", (error) => {
      device.autoRefresh = false;
      resolve(error);
    });
  });
  expect(await emitted).toBeInstanceOf(Error);
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
