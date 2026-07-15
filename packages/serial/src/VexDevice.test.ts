import { afterEach, describe, expect, test } from "bun:test";
import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { FileVendor, MatchMode, RadioChannelType } from "./Vex";
import {
  V5Radio,
  V5SerialDevice,
  downloadFileFromInternet,
  sleepUntil,
  sleepUntilAsync,
} from "./VexDevice";
import { V5SerialConnection } from "./VexConnection";
import { VexIoError, VexNotConnectedError, VexProtocolError } from "./VexError";
import { type ProgramIniConfig } from "./VexIniConfig";
import {
  GetDeviceStatusReplyD2HPacket as GetDeviceStatusReplyD2HPacketClass,
  GetRadioStatusReplyD2HPacket as GetRadioStatusReplyD2HPacketClass,
  GetSystemFlagsReplyD2HPacket as GetSystemFlagsReplyD2HPacketClass,
  GetSystemStatusReplyD2HPacket as GetSystemStatusReplyD2HPacketClass,
  LoadFileActionReplyD2HPacket,
  MatchModeReplyD2HPacket,
} from "./VexPacket";
import { VexFirmwareVersion } from "./VexFirmwareVersion";

const devices: V5SerialDevice[] = [];
const serial = {
  getPorts: async () => [],
} as unknown as Serial;
type RefreshTimer = ReturnType<typeof setInterval>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

describe("sleepUntilAsync", () => {
  test("waits between attempts and propagates predicate failures", async () => {
    let attempts = 0;
    expect(
      (
        await sleepUntilAsync(async () => ++attempts === 2, 100, 10)
      )._unsafeUnwrap(),
    ).toBe(true);
    expect(attempts).toBe(2);
    const failed = await sleepUntilAsync(async () => {
      throw new Error("predicate failed");
    }, 100);
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().message).toContain("predicate failed");
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
    const result = await downloadFileFromInternet("https://example.test/file");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("404");
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

  const result = await device.brain.uploadFirmware(
    "https://example.test/",
    "../firmware",
  );
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("invalid VEXos version");
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
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "valid-version",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("404");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful file reads resume automatic refresh", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const connection = {
    isConnected: true,
    downloadFileToHost: () => okAsync(new Uint8Array([1, 2, 3])),
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.connection = connection;

  expect(
    (
      await device.brain.readFile({ filename: "test", vendor: FileVendor.USER })
    )._unsafeUnwrap(),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(device.state.isRefreshPaused).toBe(false);
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
    downloadFileToHost: () =>
      new ResultAsync((calls++ === 0 ? first : second).then((v) => ok(v))),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const firstRead = device.brain.readFile("first");
  const secondRead = device.brain.readFile("second");
  expect(device.state.isRefreshPaused).toBe(true);

  resolveFirst(new Uint8Array([1]));
  await firstRead;
  expect(device.state.isRefreshPaused).toBe(true);

  resolveSecond(new Uint8Array([2]));
  await secondRead;
  expect(device.state.isRefreshPaused).toBe(false);
});

test("state-changing methods wait for acknowledgement before updating state", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const loadedSlots: number[] = [];
  let stopped = false;
  device.connection = {
    isConnected: true,
    setMatchMode: () => okAsync({} as MatchModeReplyD2HPacket),
    loadProgram: (slot: number) => {
      loadedSlots.push(slot);
      return okAsync({} as LoadFileActionReplyD2HPacket);
    },
    stopProgram: () => {
      stopped = true;
      return okAsync({} as LoadFileActionReplyD2HPacket);
    },
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect((await device.setMatchMode("driver")).isOk()).toBe(true);
  expect(device.matchMode).toBe("driver");
  expect((await device.brain.setActiveProgram(2)).isOk()).toBe(true);
  expect(device.brain.activeProgram).toBe(2);
  expect(loadedSlots).toEqual([2]);
  expect((await device.brain.setActiveProgram(0)).isOk()).toBe(true);
  expect(device.brain.activeProgram).toBe(0);
  expect(stopped).toBe(true);
});

test("state-changing methods report a disconnected device", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);

  expect((await device.setMatchMode("driver")).isErr()).toBe(true);
  expect((await device.brain.setActiveProgram(1)).isErr()).toBe(true);
});

test("controller uploads restore the pit channel after upload failure", async () => {
  const channels: RadioChannelType[] = [];
  class ControllerDevice extends V5SerialDevice {
    override get isV5Controller(): boolean {
      return true;
    }

    override get radio(): V5Radio {
      return {
        changeChannel: (channel: RadioChannelType) => {
          channels.push(channel);
          return okAsync(undefined);
        },
      } as unknown as V5Radio;
    }
  }

  const device = new ControllerDevice(serial);
  devices.push(device);
  device.refresh = () => okAsync<boolean>(true);
  device.connection = {
    isConnected: true,
    getSystemStatus: () => okAsync({} as never),
    uploadProgramToDevice: () => okAsync<boolean>(false),
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(
    (
      await device.brain.uploadProgram(
        {} as ProgramIniConfig,
        new Uint8Array([1]),
        undefined,
        () => {},
      )
    ).isErr(),
  ).toBe(true);
  expect(channels).toEqual([RadioChannelType.DOWNLOAD, RadioChannelType.PIT]);
});

test("automatic refresh failures are emitted instead of left unhandled", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => errAsync(new VexIoError("refresh failed"));

  const emitted = new Promise<unknown>((resolve) => {
    device.on("error", (error) => {
      device.autoRefresh = false;
      resolve(error);
    });
  });
  device.autoRefresh = true;
  expect(await emitted).toBeInstanceOf(Error);
});

test("throwing refresh error listeners do not duplicate errors or stall refresh", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timer = { unref: () => {} } as unknown as RefreshTimer;
  let refreshInterval: (() => void) | undefined;

  globalThis.setInterval = ((callback: () => void) => {
    refreshInterval = callback;
    return timer;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = (() => {}) as typeof globalThis.clearInterval;

  try {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    device.refresh = () => errAsync(new VexIoError("refresh failed"));

    const errors: unknown[] = [];
    device.on("error", () => {
      throw new Error("first listener failed");
    });
    device.on("error", (error) => errors.push(error));

    device.autoRefresh = true;
    expect(refreshInterval).toBeDefined();
    refreshInterval!();
    expect(
      (await sleepUntil(() => errors.length === 1, 1000, 10))._unsafeUnwrap(),
    ).toBe(true);
    refreshInterval!();
    expect(
      (await sleepUntil(() => errors.length === 2, 1000, 10))._unsafeUnwrap(),
    ).toBe(true);

    expect(errors).toHaveLength(2);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("automatic refresh is opt-in", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let refreshes = 0;
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => {
    refreshes++;
    return okAsync<boolean>(true);
  };

  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(refreshes).toBe(0);

  device.autoRefresh = true;
  const refreshed = await sleepUntil(() => refreshes === 1, 1000, 20);
  expect(refreshed._unsafeUnwrap()).toBe(true);
  expect(refreshes).toBe(1);

  device.autoRefresh = false;
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(refreshes).toBe(1);
});

test("automatic refresh starts its timer lazily and unrefs it", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let starts = 0;
  let stops = 0;
  let unrefs = 0;
  const timer = {
    unref: () => {
      unrefs++;
    },
  } as unknown as RefreshTimer;

  globalThis.setInterval = (() => {
    starts++;
    return timer;
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = ((interval: RefreshTimer | undefined) => {
    if (interval === timer) stops++;
  }) as typeof globalThis.clearInterval;

  try {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    expect(starts).toBe(0);

    device.autoRefresh = true;
    expect(starts).toBe(1);
    expect(unrefs).toBe(1);

    device.autoRefresh = true;
    expect(starts).toBe(1);

    device.autoRefresh = false;
    expect(stops).toBe(1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("automatic refresh uses and reschedules a configurable interval", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals: number[] = [];
  let stops = 0;
  const timer = { unref: () => {} } as unknown as RefreshTimer;

  globalThis.setInterval = ((
    ...args: Parameters<typeof globalThis.setInterval>
  ) => {
    intervals.push(args[1] ?? 0);
    return timer;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = ((interval: RefreshTimer | undefined) => {
    if (interval === timer) stops++;
  }) as typeof globalThis.clearInterval;

  try {
    const device = new V5SerialDevice(serial, {
      autoRefresh: true,
      refreshIntervalMs: 500,
    });
    devices.push(device);

    expect(intervals).toEqual([500]);
    expect(device.refreshIntervalMs).toBe(500);

    device.refreshIntervalMs = 1_000;
    expect(intervals).toEqual([500, 1_000]);
    expect(stops).toBe(1);

    expect(() => (device.refreshIntervalMs = 0)).toThrow("positive finite");
    expect(() => (device.refreshIntervalMs = Number.NaN)).toThrow(
      "positive finite",
    );
    device.autoRefresh = false;
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
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
    open: () => {
      opened = true;
      connected = true;
      return okAsync("opened" as const);
    },
    query1: () => okAsync({} as never),
    on: () => {},
    remove: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);

  expect((await device.connect(connection)).isOk()).toBe(true);
  expect(opened).toBe(true);
  expect(device.connection).toBe(connection);
});

test("connect requires its initial refresh to produce a current snapshot", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let connected = true;
  let disconnected: (() => void) | undefined;
  let removes = 0;
  let closes = 0;
  const connection = {
    get isConnected() {
      return connected;
    },
    query1: () => okAsync({} as never),
    ...buildReply({ system: { uniqueId: 0x1234 } }),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    remove: (event: string, listener: () => void) => {
      if (event === "disconnected" && listener === disconnected) {
        removes++;
        disconnected = undefined;
      }
    },
    close: async () => {
      closes++;
      connected = false;
    },
  } as unknown as V5SerialConnection;

  expect((await device.connect(connection)).isOk()).toBe(true);
  expect(device.connection).toBe(connection);
  expect(device.brain.uniqueId).toBe(0x1234);

  await device.disconnect();
  expect(closes).toBe(1);
  expect(removes).toBe(1);
});

test("connect discards a connection when its initial refresh is incomplete", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let connected = true;
  let disconnected: (() => void) | undefined;
  let removes = 0;
  let closes = 0;
  const connection = {
    get isConnected() {
      return connected;
    },
    query1: () => okAsync({} as never),
    ...buildReply({}),
    getSystemStatus: () => errAsync(new VexProtocolError("status nack")),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    remove: (event: string, listener: () => void) => {
      if (event === "disconnected" && listener === disconnected) {
        removes++;
        disconnected = undefined;
      }
    },
    close: async () => {
      closes++;
      connected = false;
    },
  } as unknown as V5SerialConnection;

  const result = await device.connect(connection);

  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr()).toBeInstanceOf(VexNotConnectedError);
  expect(result._unsafeUnwrapErr().message).toContain("initial device refresh");
  expect(device.connection).toBeUndefined();
  expect(disconnected).toBeUndefined();
  expect(removes).toBe(1);
  expect(closes).toBe(1);
});

for (const autoReconnect of [false, true]) {
  test(`disconnect during initial refresh fails connect and cleans up when autoReconnect is ${autoReconnect}`, async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.autoReconnect = autoReconnect;
    const replies = Array.from({ length: 4 }, () => createDeferred<void>());
    let refreshRequests = 0;
    let connected = true;
    let disconnected: (() => void) | undefined;
    let removes = 0;
    let reconnects = 0;
    const nextReply = () => {
      const reply = replies[refreshRequests++];
      if (reply === undefined) throw new Error("unexpected refresh request");
      return new ResultAsync(reply.promise.then(() => ok({} as never)));
    };
    const connection = {
      get isConnected() {
        return connected;
      },
      query1: () => okAsync({} as never),
      getSystemStatus: nextReply,
      getSystemFlags: nextReply,
      getRadioStatus: nextReply,
      getDeviceStatus: nextReply,
      on: (event: string, listener: () => void) => {
        if (event === "disconnected") disconnected = listener;
      },
      remove: (event: string, listener: () => void) => {
        if (event === "disconnected" && listener === disconnected) {
          removes++;
          disconnected = undefined;
        }
      },
      close: async () => {
        connected = false;
      },
    } as unknown as V5SerialConnection;
    device.reconnect = () => {
      reconnects++;
      return okAsync(undefined);
    };

    const pending = device.connect(connection);
    expect(
      (await sleepUntil(() => refreshRequests === 4, 100))._unsafeUnwrap(),
    ).toBe(true);
    expect(refreshRequests).toBe(4);

    connected = false;
    disconnected?.();
    for (const reply of replies) reply.resolve();

    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(device.connection).toBeUndefined();
    expect(disconnected).toBeUndefined();
    expect(removes).toBe(1);
    expect(reconnects).toBe(autoReconnect ? 1 : 0);
  });
}

test("connect stops after requestPort returns an unresponsive port again", async () => {
  let readable: ReadableStream<Uint8Array> | null = null;
  let writable: WritableStream<Uint8Array> | null = null;
  let openCount = 0;
  let requestCount = 0;
  const port = {
    get readable() {
      return readable;
    },
    get writable() {
      return writable;
    },
    getInfo: () => ({
      usbVendorId: 10376,
      usbProductId: 1281,
      path: "/dev/ttyACM1",
    }),
    open: async () => {
      openCount++;
      readable = new ReadableStream<Uint8Array>();
      writable = new WritableStream<Uint8Array>();
    },
    close: async () => {
      readable = null;
      writable = null;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as SerialPort;
  const retryingSerial = {
    getPorts: async () => [port],
    requestPort: async () => {
      requestCount++;
      return port;
    },
  } as unknown as Serial;
  const device = new V5SerialDevice(retryingSerial);
  devices.push(device);

  const result = await device.connect();

  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr()).toBeInstanceOf(VexNotConnectedError);
  expect(result._unsafeUnwrapErr().message).toContain("/dev/ttyACM1");
  expect(openCount).toBe(2);
  expect(requestCount).toBe(1);
});

test("explicit disconnect does not trigger automatic reconnect", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let disconnected: (() => void) | undefined;
  let reconnects = 0;
  const connection = {
    isConnected: true,
    query1: () => okAsync({} as never),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    remove: (event: string, listener: () => void) => {
      if (event === "disconnected" && listener === disconnected) {
        disconnected = undefined;
      }
    },
    close: async () => disconnected?.(),
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);
  device.reconnect = () => {
    reconnects++;
    return okAsync(undefined);
  };

  await device.connect(connection);
  await device.disconnect();
  expect(reconnects).toBe(0);
});

test("reusing a connection does not stack disconnected listeners", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let connected = false;
  const disconnectedListeners = new Set<() => void>();
  const connection = {
    get isConnected() {
      return connected;
    },
    open: () => {
      connected = true;
      return okAsync("opened" as const);
    },
    query1: () => okAsync({} as never),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnectedListeners.add(listener);
    },
    remove: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnectedListeners.delete(listener);
    },
    close: async () => {
      connected = false;
    },
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);
  let deviceDisconnects = 0;
  let reconnects = 0;
  device.on("disconnected", () => deviceDisconnects++);
  device.reconnect = () => {
    reconnects++;
    return okAsync(undefined);
  };

  await device.connect(connection);
  await device.disconnect();
  await device.connect(connection);

  expect(disconnectedListeners.size).toBe(1);
  for (const listener of disconnectedListeners) listener();
  expect(deviceDisconnects).toBe(1);
  expect(reconnects).toBe(1);

  await device.disconnect();
  expect(disconnectedListeners.size).toBe(0);
});

test("throwing disconnected listeners do not prevent automatic reconnect", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let disconnected: (() => void) | undefined;
  let reconnects = 0;
  const connection = {
    isConnected: true,
    query1: () => okAsync({} as never),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    remove: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);
  device.reconnect = () => {
    reconnects++;
    return okAsync(undefined);
  };

  let laterListenerCalls = 0;
  device.on("disconnected", () => {
    throw new Error("first listener failed");
  });
  device.on("disconnected", () => laterListenerCalls++);

  await device.connect(connection);
  expect(disconnected).toBeDefined();
  expect(() => disconnected!()).not.toThrow();
  expect(laterListenerCalls).toBe(1);
  expect(reconnects).toBe(1);
});

test("throwing reconnect error listeners do not reject or emit twice", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let disconnected: (() => void) | undefined;
  const connection = {
    isConnected: true,
    query1: () => okAsync({} as never),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    remove: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);
  device.reconnect = () => errAsync(new VexIoError("reconnect failed"));

  const errors: unknown[] = [];
  device.on("error", () => {
    throw new Error("first listener failed");
  });
  device.on("error", (error) => errors.push(error));

  await device.connect(connection);
  expect(disconnected).toBeDefined();
  expect(() => disconnected!()).not.toThrow();
  expect(
    (await sleepUntil(() => errors.length === 1, 1000, 10))._unsafeUnwrap(),
  ).toBe(true);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(VexIoError);
});

test("disconnect invalidates and closes a pending supplied connection", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const openStarted = createDeferred<void>();
  const finishOpen = createDeferred<void>();
  let connected = false;
  let closes = 0;
  let queries = 0;
  const connection = {
    get isConnected() {
      return connected;
    },
    open: () => {
      openStarted.resolve();
      return new ResultAsync(
        finishOpen.promise.then(() => {
          connected = true;
          return ok("opened" as const);
        }),
      );
    },
    query1: () => {
      queries++;
      return okAsync({} as never);
    },
    on: () => {},
    remove: () => {},
    close: async () => {
      closes++;
      connected = false;
    },
  } as unknown as V5SerialConnection;

  const pending = device.connect(connection);
  await openStarted.promise;
  await device.disconnect();
  finishOpen.resolve();
  const result = await pending;

  expect(result.isErr()).toBe(true);
  expect(device.connection).toBeUndefined();
  expect(queries).toBe(0);
  expect(closes).toBe(1);
});

test("dispose invalidates pending and future connection attempts", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const openStarted = createDeferred<void>();
  const finishOpen = createDeferred<void>();
  let connected = false;
  let closes = 0;
  let opens = 0;
  const pendingConnection = {
    get isConnected() {
      return connected;
    },
    open: () => {
      opens++;
      openStarted.resolve();
      return new ResultAsync(
        finishOpen.promise.then(() => {
          connected = true;
          return ok("opened" as const);
        }),
      );
    },
    query1: () => okAsync({} as never),
    on: () => {},
    remove: () => {},
    close: async () => {
      closes++;
      connected = false;
    },
  } as unknown as V5SerialConnection;
  const futureConnection = {
    isConnected: false,
    open: () => {
      opens++;
      return okAsync("opened" as const);
    },
  } as unknown as V5SerialConnection;

  const pending = device.connect(pendingConnection);
  await openStarted.promise;
  await device.dispose();
  finishOpen.resolve();

  expect((await pending).isErr()).toBe(true);
  expect(device.connection).toBeUndefined();
  expect(closes).toBe(1);
  expect((await device.connect(futureConnection)).isErr()).toBe(true);
  expect((await device.reconnect(1)).isErr()).toBe(true);
  expect(opens).toBe(1);
});

test("manual connect supersedes an in-flight reconnect", async () => {
  const reconnectOpenStarted = createDeferred<void>();
  const finishReconnectOpen = createDeferred<void>();
  let reconnectConnected = false;
  let reconnectCloses = 0;
  const reconnectConnection = {
    get isConnected() {
      return reconnectConnected;
    },
    open: () => {
      reconnectOpenStarted.resolve();
      return new ResultAsync(
        finishReconnectOpen.promise.then(() => {
          reconnectConnected = true;
          return ok("opened" as const);
        }),
      );
    },
    getSystemStatus: () => okAsync({ uniqueId: 0 } as never),
    on: () => {},
    remove: () => {},
    close: async () => {
      reconnectCloses++;
      reconnectConnected = false;
    },
  } as unknown as V5SerialConnection;
  class TestDevice extends V5SerialDevice {
    constructor(connection: V5SerialConnection) {
      super(serial);
      this.connectionToCreate = connection;
    }

    private connectionToCreate: V5SerialConnection;

    protected createConnection(): V5SerialConnection {
      return this.connectionToCreate;
    }
  }
  const device = new TestDevice(reconnectConnection);
  devices.push(device);
  device.refresh = () => okAsync<boolean>(true);
  const manualConnection = {
    isConnected: true,
    query1: () => okAsync({} as never),
    on: () => {},
    remove: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;

  const reconnect = device.reconnect();
  await reconnectOpenStarted.promise;
  expect((await device.connect(manualConnection)).isOk()).toBe(true);
  finishReconnectOpen.resolve();

  expect((await reconnect).isErr()).toBe(true);
  expect(device.connection).toBe(manualConnection);
  expect(reconnectCloses).toBe(1);
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

  const result = await device.reconnect(100);
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("port discovery failed");
  expect(device.isReconnecting).toBe(false);
});

describe("sleepUntil and sleepUntilAsync argument validation", () => {
  test("rejects non-positive intervals", async () => {
    let r = await sleepUntilAsync(async () => true, 10, 0);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("interval must be positive");
    r = await sleepUntil(() => true, 10, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("interval must be positive");
  });

  test("rejects negative timeouts", async () => {
    let r = await sleepUntilAsync(async () => true, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain(
      "timeout must be non-negative",
    );
    r = await sleepUntil(() => true, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain(
      "timeout must be non-negative",
    );
  });

  test("predicate exceptions reject without leaving timers behind", async () => {
    const r = await sleepUntilAsync(
      async () => {
        throw new Error("boom");
      },
      100,
      5,
    );
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("boom");
  });
});

describe("downloadFileFromInternet streaming limits", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects bodies that exceed the configured byte limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    globalThis.fetch = Object.assign(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": "16" },
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const r = await downloadFileFromInternet("https://example.test/big", {
      maxBytes: 10,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("exceeds limit");
  });

  test("accepts bodies that fit within the configured byte limit", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = Object.assign(
      async () => new Response(body, { status: 200 }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const result = await downloadFileFromInternet("https://example.test/ok", {
      maxBytes: 10,
    });
    expect(new Uint8Array(result._unsafeUnwrap())).toEqual(body);
  });

  test("accepts known-length responses delivered in multiple chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    globalThis.fetch = Object.assign(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": "4" },
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const result = await downloadFileFromInternet(
      "https://example.test/known",
      { maxBytes: 10 },
    );
    expect(new Uint8Array(result._unsafeUnwrap())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  test("grows a bounded buffer for chunked responses", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.enqueue(new Uint8Array([2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    globalThis.fetch = Object.assign(
      async () => new Response(body, { status: 200 }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const result = await downloadFileFromInternet(
      "https://example.test/chunked",
      { maxBytes: 10 },
    );
    expect(new Uint8Array(result._unsafeUnwrap())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );
  });

  test("rejects declared content length that exceeds the limit", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response("", {
          status: 200,
          headers: { "content-length": "1024" },
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const r = await downloadFileFromInternet("https://example.test/big", {
      maxBytes: 10,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("exceeds limit");
  });
});

function buildReply(args: {
  system?: Partial<GetSystemStatusReplyD2HPacketClass>;
  flags?: Partial<GetSystemFlagsReplyD2HPacketClass>;
  radio?: Partial<GetRadioStatusReplyD2HPacketClass>;
  devices?: Partial<GetDeviceStatusReplyD2HPacketClass>;
}) {
  return {
    getSystemStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetSystemStatusReplyD2HPacketClass.prototype),
          {
            cpu0Version: VexFirmwareVersion.allZero(),
            cpu1Version: VexFirmwareVersion.allZero(),
            systemVersion: VexFirmwareVersion.allZero(),
            uniqueId: 0,
            sysflags: [0, 0, 0, 0, 0, 0, 0],
            ...args.system,
          },
        ) as GetSystemStatusReplyD2HPacketClass,
      ),
    getSystemFlags: () =>
      okAsync(
        Object.assign(
          Object.create(GetSystemFlagsReplyD2HPacketClass.prototype),
          {
            flags: 0,
            battery: 0,
            controllerBatteryPercent: 0,
            partnerControllerBatteryPercent: 0,
            currentProgram: 0,
            ...args.flags,
          },
        ) as GetSystemFlagsReplyD2HPacketClass,
      ),
    getRadioStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetRadioStatusReplyD2HPacketClass.prototype),
          {
            device: 0,
            quality: 0,
            strength: 0,
            channel: 0,
            timeslot: 0,
            ...args.radio,
          },
        ) as GetRadioStatusReplyD2HPacketClass,
      ),
    getDeviceStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetDeviceStatusReplyD2HPacketClass.prototype),
          {
            count: 0,
            devices: [],
            ...args.devices,
          },
        ) as GetDeviceStatusReplyD2HPacketClass,
      ),
  };
}

describe("refresh snapshot safety", () => {
  test("pipelines all status requests before awaiting replies", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    const replies = buildReply({});
    const gates = [
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
    ];
    const started: string[] = [];
    const request = <T>(name: string, index: number, getReply: () => T) => {
      started.push(name);
      return gates[index]!.promise.then(getReply);
    };
    device.connection = {
      isConnected: true,
      getSystemStatus: () =>
        request("system", 0, () => replies.getSystemStatus()),
      getSystemFlags: () => request("flags", 1, () => replies.getSystemFlags()),
      getRadioStatus: () => request("radio", 2, () => replies.getRadioStatus()),
      getDeviceStatus: () =>
        request("devices", 3, () => replies.getDeviceStatus()),
      close: async () => {},
    } as unknown as V5SerialConnection;

    const refresh = device.refresh();
    await Bun.sleep(0);
    expect(started).toEqual(["system", "flags", "radio", "devices"]);

    for (const gate of gates) gate.resolve();
    expect((await refresh)._unsafeUnwrap()).toBe(true);
  });

  test("refresh does not mirror primary charging state to the partner", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      ...buildReply({
        system: {
          sysflags: [0, 0, 0b10000000, 0, 0, 0, 0],
        },
        flags: {
          flags: 8192,
          partnerControllerBatteryPercent: 88,
        },
      }),
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.refresh())._unsafeUnwrap()).toBe(true);
    expect(device.controllers[0].isCharging).toBe(true);
    expect(device.controllers[1].batteryPercent).toBe(88);
    expect(device.controllers[1].isAvailable).toBe(true);
    expect(device.controllers[1].isCharging).toBeUndefined();
  });

  test("unchanged smart-device telemetry preserves the state array", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      ...buildReply({
        devices: {
          count: 1,
          devices: [
            {
              port: 1,
              type: 2,
              status: 3,
              betaversion: 4,
              version: 5,
              bootversion: 6,
            },
          ],
        },
      }),
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.refresh())._unsafeUnwrap()).toBe(true);
    const previousDevices = device.state.devices;

    expect((await device.refresh())._unsafeUnwrap()).toBe(true);
    expect(device.state.devices).toBe(previousDevices);
  });

  test("partial refresh failure preserves the previous coherent snapshot", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    let calls = 0;
    const replies = buildReply({
      system: {
        cpu0Version: new VexFirmwareVersion(1, 2, 3, 4),
        uniqueId: 0xdeadbeef,
        sysflags: [0, 0, 0b00100000, 0, 0, 0, 0],
      },
      flags: { currentProgram: 0 },
      radio: { channel: 7 },
      devices: { count: 0, devices: [] },
    });
    device.connection = {
      isConnected: true,
      ...replies,
      getSystemStatus: () => {
        calls++;
        // second refresh fails at first call
        return calls === 2
          ? errAsync(new VexProtocolError("system status nack"))
          : replies.getSystemStatus();
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.refresh())._unsafeUnwrap()).toBe(true);
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("1.2.3.b4");
    expect(device.state.radio.channel).toBe(7);
    expect(device.state.matchMode).toBe("disabled");
    expect(device.state.brain.isAvailable).toBe(true);

    const next = await device.refresh();
    expect(next._unsafeUnwrap()).toBe(false);
    expect(device.state.brain.isAvailable).toBe(false);
    // Previous coherent snapshot is preserved.
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("1.2.3.b4");
    expect(device.state.radio.channel).toBe(7);
    expect(device.state.matchMode).toBe("disabled");
  });

  test("a generation that began before disposal does not commit state", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    let resolveStatus:
      | ((value: GetSystemStatusReplyD2HPacketClass) => void)
      | null = null;
    const gate = new Promise<GetSystemStatusReplyD2HPacketClass>((resolve) => {
      resolveStatus = resolve;
    });
    const replies = buildReply({
      system: {
        cpu0Version: new VexFirmwareVersion(9, 9, 9, 9),
      },
    });
    device.connection = {
      isConnected: true,
      ...replies,
      getSystemStatus: async () => ok(await gate),
      close: async () => {},
    } as unknown as V5SerialConnection;

    const refresh = device.refresh();
    await Bun.sleep(0);
    await device.dispose();
    (
      resolveStatus as
        | ((value: GetSystemStatusReplyD2HPacketClass) => void)
        | null
    )?.(
      Object.assign(
        Object.create(GetSystemStatusReplyD2HPacketClass.prototype),
        {
          cpu0Version: new VexFirmwareVersion(9, 9, 9, 9),
          cpu1Version: VexFirmwareVersion.allZero(),
          systemVersion: VexFirmwareVersion.allZero(),
          uniqueId: 0,
          sysflags: [0, 0, 0, 0, 0, 0, 0],
        },
      ) as GetSystemStatusReplyD2HPacketClass,
    );
    const result = await refresh;
    expect(result._unsafeUnwrap()).toBe(false);
    // The state must NOT have been committed by a generation that
    // started before the device was disposed.
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("0.0.0.b0");
  });
});

describe("promise-returning program/match state", () => {
  test("setMatchMode updates state only after the device acknowledges", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    const calls: MatchMode[] = [];
    const replies: Array<MatchModeReplyD2HPacket | null> = [];
    device.connection = {
      isConnected: true,
      setMatchMode: (mode: MatchMode) => {
        calls.push(mode);
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("setMatchMode nack"))
          : okAsync(r);
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    replies.push(
      Object.create(
        MatchModeReplyD2HPacket.prototype,
      ) as MatchModeReplyD2HPacket,
    );
    expect((await device.setMatchMode("autonomous")).isOk()).toBe(true);
    expect(device.state.matchMode).toBe("autonomous");
    expect(calls).toEqual(["autonomous"]);

    // Reject path: state is not updated and the method resolves to an error.
    replies.push(null);
    expect((await device.setMatchMode("driver")).isErr()).toBe(true);
    expect(device.state.matchMode).toBe("autonomous");
  });

  test("runProgram and stopProgram return observable promises", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    const calls: Array<string | number> = [];
    const replies: Array<LoadFileActionReplyD2HPacket | null> = [
      Object.create(
        LoadFileActionReplyD2HPacket.prototype,
      ) as LoadFileActionReplyD2HPacket,
      null,
    ];
    device.connection = {
      isConnected: true,
      runProgram: (slot: string | number) => {
        calls.push(slot);
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("runProgram nack"))
          : okAsync(r);
      },
      stopProgram: () => {
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("stopProgram nack"))
          : okAsync(r);
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.brain.runProgram(1)).isOk()).toBe(true);
    expect(device.state.brain.activeProgram).toBe(1);
    expect(calls).toEqual([1]);

    expect((await device.brain.stopProgram()).isErr()).toBe(true);
    expect(device.state.brain.activeProgram).toBe(1);
  });

  test("runProgram with a filename does not parse activeProgram from the name", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.state.brain.activeProgram = 4;
    const calls: Array<string | number> = [];
    device.connection = {
      isConnected: true,
      runProgram: (slot: string | number) => {
        calls.push(slot);
        return okAsync(
          Object.create(
            LoadFileActionReplyD2HPacket.prototype,
          ) as LoadFileActionReplyD2HPacket,
        );
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.brain.runProgram("123-program.bin")).isOk()).toBe(
      true,
    );
    expect(calls).toEqual(["123-program.bin"]);
    expect(device.state.brain.activeProgram).toBe(4);
  });

  test("setMatchMode reports a disconnected device", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: false,
      setMatchMode: () => errAsync(new VexProtocolError("setMatchMode nack")),
      close: async () => {},
    } as unknown as V5SerialConnection;
    expect((await device.setMatchMode("disabled")).isErr()).toBe(true);
  });

  test("changeChannel reports a disconnected device", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);

    const result = await device.radio.changeChannel(RadioChannelType.PIT);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(VexNotConnectedError);
  });
});

describe("firmware size limits", () => {
  function makeZip(
    entries: Array<{ name: string; data: Uint8Array }>,
  ): Uint8Array {
    // Minimal valid ZIP writer: uses CRC32 + STORED (no compression) entries,
    // followed by a central directory. Enough for unzipit to parse the
    // entries and for our size-validation code to inspect them.
    const crcTable = (() => {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++)
          c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
      return table;
    })();
    const crc32 = (data: Uint8Array) => {
      let c = 0xffffffff;
      for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

    const fileRecords: Uint8Array[] = [];
    const centralRecords: Uint8Array[] = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const crc = crc32(entry.data);
      const local = new Uint8Array(30 + nameBytes.byteLength);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, entry.data.byteLength, true);
      view.setUint32(22, entry.data.byteLength, true);
      view.setUint16(26, nameBytes.byteLength, true);
      view.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      fileRecords.push(local, entry.data);
      const localStart = offset;
      offset += local.byteLength;
      offset += entry.data.byteLength;

      const central = new Uint8Array(46 + nameBytes.byteLength);
      const cview = new DataView(central.buffer);
      cview.setUint32(0, 0x02014b50, true);
      cview.setUint16(4, 20, true);
      cview.setUint16(6, 20, true);
      cview.setUint16(8, 0, true);
      cview.setUint16(10, 0, true);
      cview.setUint16(12, 0, true);
      cview.setUint32(16, crc, true);
      cview.setUint32(20, entry.data.byteLength, true);
      cview.setUint32(24, entry.data.byteLength, true);
      cview.setUint16(28, nameBytes.byteLength, true);
      cview.setUint16(30, 0, true);
      cview.setUint16(32, 0, true);
      cview.setUint16(34, 0, true);
      cview.setUint16(36, 0, true);
      cview.setUint32(38, 0, true);
      cview.setUint32(42, localStart, true);
      central.set(nameBytes, 46);
      centralRecords.push(central);
    }

    const centralSize = centralRecords.reduce((s, b) => s + b.byteLength, 0);
    const centralStart = offset;
    offset += centralSize;

    const end = new Uint8Array(22);
    const eview = new DataView(end.buffer);
    eview.setUint32(0, 0x06054b50, true);
    eview.setUint16(8, entries.length, true);
    eview.setUint16(10, entries.length, true);
    eview.setUint32(12, centralSize, true);
    eview.setUint32(16, centralStart, true);

    const total = offset + end.byteLength;
    const out = new Uint8Array(total);
    let p = 0;
    for (const chunk of fileRecords) {
      out.set(chunk, p);
      p += chunk.byteLength;
    }
    for (const chunk of centralRecords) {
      out.set(chunk, p);
      p += chunk.byteLength;
    }
    out.set(end, p);
    return out;
  }

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchBytes(bytes: Uint8Array) {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(new Blob([bytes as unknown as ArrayBuffer]), {
          status: 200,
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;
  }

  test("per-entry firmware image is rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    // Allocate a buffer larger than the per-entry limit (32 MB) without
    // pulling 40 MB into memory at once. The validation should reject
    // based on the declared entry size before any of the body is
    // materialised.
    const huge = new Uint8Array(33 * 1024 * 1024);
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: huge },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("per-entry limit");
  });

  test("aggregate firmware size is rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    // Two entries of 25 MB each pass the 32 MB per-entry check but
    // together exceed the 48 MB aggregate limit.
    const half = new Uint8Array(25 * 1024 * 1024);
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: half },
      { name: "1.0.0/assets.bin", data: half },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("aggregate");
  });

  test("unexpected ZIP entries are rejected before any upload", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: new Uint8Array(16) },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
      { name: "1.0.0/extra.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("unexpected entries");
  });

  test("empty firmware entries are rejected before any upload", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: new Uint8Array(0) },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("empty");
  });

  test("compressed VEXos archives are rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    mockFetchBytes(new Uint8Array(200 * 1024 * 1024));
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
  });
});
