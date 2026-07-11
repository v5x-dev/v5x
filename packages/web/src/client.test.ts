import { describe, expect, test } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { VexFirmwareVersion, VexSerialError } from "@v5x/serial";
import {
  createV5ClientWithFactory,
  type V5ConnectionStatus,
  type V5DeviceLike,
} from "./client.js";
import { V5WebError } from "./errors.js";

interface FakeDevice {
  autoRefresh: boolean;
  autoReconnect?: boolean;
  state?: V5DeviceLike["state"];
  connect(): ResultAsync<void, VexSerialError>;
  disconnect(): Promise<void>;
  dispose?: () => Promise<void>;
  refresh(): ResultAsync<boolean, VexSerialError>;
  on?: V5DeviceLike["on"];
  remove?: V5DeviceLike["remove"];
}

class FakeSerial extends EventTarget implements Serial {
  onconnect: (event: Event) => void = () => {};
  ondisconnect: (event: Event) => void = () => {};

  async getPorts(): Promise<SerialPort[]> {
    return [];
  }

  async requestPort(): Promise<SerialPort> {
    throw new Error("not implemented");
  }
}

const serial = new FakeSerial();

function createClient(device: FakeDevice) {
  return createV5ClientWithFactory({ serial }, () => device);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createFakeDeviceState(): NonNullable<V5DeviceLike["state"]> {
  return {
    brain: {
      activeProgram: 0,
      battery: {
        batteryPercent: 0,
        isCharging: false,
      },
      button: {
        isPressed: false,
        isDoublePressed: false,
      },
      cpu0Version: VexFirmwareVersion.allZero(),
      cpu1Version: VexFirmwareVersion.allZero(),
      isAvailable: false,
      settings: {
        isScreenReversed: false,
        isWhiteTheme: false,
        usingLanguage: 0,
      },
      systemVersion: VexFirmwareVersion.allZero(),
      uniqueId: 0,
    },
    controllers: [
      {
        battery: 0,
        isAvailable: false,
        isCharging: false,
      },
      {
        battery: 0,
        isAvailable: false,
        isCharging: false,
      },
    ],
    devices: [],
    isFieldControllerConnected: false,
    matchMode: "disabled",
    radio: {
      channel: 0,
      isAvailable: false,
      isConnected: false,
      isVexNet: false,
      isRadioData: false,
      latency: 0,
      signalQuality: 0,
      signalStrength: 0,
    },
  };
}

describe("createV5Client", () => {
  test("starts unsupported when no serial object exists", () => {
    const client = createV5ClientWithFactory({}, () => ({
      autoRefresh: false,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    }));

    expect(client.getSnapshot()).toMatchObject({
      status: "unsupported",
      supported: false,
      unavailableReason: "non-browser-runtime",
      connected: false,
    });
  });

  test("notifies subscribers on state changes", async () => {
    const statuses: V5ConnectionStatus[] = [];
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    client.subscribe(() => statuses.push(client.getSnapshot().status));

    expect(await client.connect()).toBe(true);

    expect(statuses).toEqual(["connecting", "connected"]);
  });

  test("unsubscribe prevents further notifications", async () => {
    let calls = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    const unsubscribe = client.subscribe(() => calls++);
    unsubscribe();

    await client.connect();

    expect(calls).toBe(0);
  });

  test("subscriber exceptions do not affect successful connect, refresh, or disconnect", async () => {
    const statuses: V5ConnectionStatus[] = [];
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      state: createFakeDeviceState(),
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(true),
    });

    client.subscribe(() => {
      throw new Error("subscriber failed");
    });
    client.subscribe(() => statuses.push(client.getSnapshot().status));

    expect(await client.connect()).toBe(true);
    await client.refresh();
    await client.disconnect();

    expect(disposes).toBe(1);
    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      connected: false,
      error: null,
    });
    expect(statuses).toEqual([
      "connecting",
      "connected",
      "connected",
      "disconnecting",
      "idle",
    ]);
  });

  test("subscriber exceptions do not alter error or idle publications", async () => {
    const statuses: V5ConnectionStatus[] = [];
    const client = createClient({
      autoRefresh: true,
      connect: () => errAsync(new VexSerialError("io", "connect failed")),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    client.subscribe(() => {
      throw new Error("subscriber failed");
    });
    client.subscribe(() => statuses.push(client.getSnapshot().status));

    expect(await client.connect()).toBe(false);
    expect(client.getSnapshot().error?.code).toBe("connect-failed");
    await client.disconnect();

    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      error: null,
    });
    expect(statuses).toEqual(["connecting", "error", "idle"]);
  });

  test("successful connect transitions through connecting to connected", async () => {
    const statuses: V5ConnectionStatus[] = [];
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    client.subscribe(() => statuses.push(client.getSnapshot().status));

    const connected = await client.connect();

    expect(connected).toBe(true);
    expect(client.getSnapshot()).toMatchObject({
      status: "connected",
      connected: true,
      connecting: false,
      error: null,
    });
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  test("failed connect transitions to error", async () => {
    const client = createClient({
      autoRefresh: true,
      connect: () => errAsync(new VexSerialError("io", "connect failed")),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    const connected = await client.connect();
    const snapshot = client.getSnapshot();

    expect(connected).toBe(false);
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toBeInstanceOf(V5WebError);
    expect(snapshot.error?.code).toBe("connect-failed");
  });

  test("disconnect is idempotent", async () => {
    let disconnects = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {
        disconnects++;
      },
      refresh: () => okAsync(true),
    });

    await client.connect();
    await client.disconnect();
    await client.disconnect();

    expect(disconnects).toBe(1);
    expect(client.getSnapshot().status).toBe("idle");
  });

  test("disconnect during an in-flight successful connect leaves the client idle", async () => {
    const connectDeferred = createDeferred<void>();
    let disposes = 0;
    let refreshes = 0;
    const device: FakeDevice = {
      autoRefresh: true,
      connect: () =>
        ResultAsync.fromPromise(
          connectDeferred.promise,
          () => new VexSerialError("io", "connect failed"),
        ),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => {
        refreshes++;
        return okAsync(true);
      },
    };
    const client = createV5ClientWithFactory(
      { serial, refreshIntervalMs: 1 },
      () => device,
    );

    const connectPromise = client.connect();
    expect(client.getSnapshot().status).toBe("connecting");

    await client.disconnect();
    connectDeferred.resolve(undefined);
    const connected = await connectPromise;

    expect(connected).toBe(false);
    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      connected: false,
      error: null,
    });
    expect(disposes).toBe(1);

    await delay(20);
    expect(refreshes).toBe(0);
  });

  test("disconnect during an in-flight failed connect leaves the client idle", async () => {
    const connectDeferred = createDeferred<void>();
    const connectError = new VexSerialError("io", "connect failed");
    let disposes = 0;
    const device: FakeDevice = {
      autoRefresh: true,
      connect: () =>
        ResultAsync.fromPromise(
          connectDeferred.promise.then(() => {
            throw connectError;
          }),
          (error) =>
            error instanceof VexSerialError
              ? error
              : new VexSerialError("io", "connect failed"),
        ),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(true),
    };
    const client = createClient(device);

    const connectPromise = client.connect();
    expect(client.getSnapshot().status).toBe("connecting");

    await client.disconnect();
    connectDeferred.resolve(undefined);
    const connected = await connectPromise;

    expect(connected).toBe(false);
    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      connected: false,
      error: null,
    });
    expect(disposes).toBe(1);
  });

  test("connect while disconnecting does not clobber the disconnect lifecycle", async () => {
    const disconnectDeferred = createDeferred<void>();
    let connects = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => {
        connects++;
        return okAsync(undefined);
      },
      disconnect: async () => {
        await disconnectDeferred.promise;
      },
      refresh: () => okAsync(true),
    });

    await client.connect();
    const disconnectPromise = client.disconnect();
    expect(client.getSnapshot().status).toBe("disconnecting");

    const connected = await client.connect();
    expect(connected).toBe(false);
    expect(client.getSnapshot().status).toBe("disconnecting");

    disconnectDeferred.resolve(undefined);
    await disconnectPromise;

    expect(connects).toBe(1);
    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      connected: false,
    });
  });

  test("failed connect reports the error from the result channel", async () => {
    const client = createClient({
      autoRefresh: true,
      connect: () => errAsync(new VexSerialError("io", "serial exploded")),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    });

    const connected = await client.connect();
    const error = client.getSnapshot().error;

    expect(connected).toBe(false);
    expect(error).toBeInstanceOf(V5WebError);
    expect(error?.code).toBe("connect-failed");
  });

  test("refresh result errors detach and dispose the stale device", async () => {
    const refreshError = new VexSerialError("io", "refresh failed");
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => errAsync(refreshError),
    });

    await client.connect();
    await client.refresh();
    const snapshot = client.getSnapshot();

    expect(snapshot).toMatchObject({
      status: "error",
      connected: false,
    });
    expect(snapshot.error).toBeInstanceOf(V5WebError);
    expect(snapshot.error?.code).toBe("refresh-error");
    expect(snapshot.error?.cause).toBe(refreshError);
    expect(disposes).toBe(1);
  });

  test("unsuccessful refreshes detach and dispose the stale device", async () => {
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(false),
    });

    await client.connect();
    await client.refresh();
    const snapshot = client.getSnapshot();

    expect(snapshot).toMatchObject({
      status: "error",
      connected: false,
      device: null,
    });
    expect(snapshot.error).toBeInstanceOf(V5WebError);
    expect(snapshot.error?.code).toBe("refresh-error");
    expect(snapshot.error?.message).toBe(
      "V5 device refresh did not produce a current snapshot.",
    );
    expect(disposes).toBe(1);
  });

  test("refresh calls coalesce while a refresh is already in flight", async () => {
    const refreshDeferred = createDeferred<boolean>();
    let refreshes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => {
        refreshes++;
        return ResultAsync.fromPromise(
          refreshDeferred.promise,
          () => new VexSerialError("io", "refresh failed"),
        );
      },
    });

    await client.connect();
    const firstRefresh = client.refresh();
    const secondRefresh = client.refresh();

    expect(refreshes).toBe(1);

    refreshDeferred.resolve(true);
    await Promise.all([firstRefresh, secondRefresh]);

    expect(refreshes).toBe(1);
    expect(client.getSnapshot().status).toBe("connected");
  });

  test("successful refresh publishes updated device state in the snapshot", async () => {
    const state = createFakeDeviceState();
    const client = createClient({
      autoRefresh: true,
      state,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => {
        state.brain.battery.batteryPercent = 82;
        state.brain.activeProgram = 3;
        state.radio.isConnected = true;
        return okAsync(true);
      },
    });

    await client.connect();
    const initialVersion = client.getSnapshot().deviceVersion;

    await client.refresh();
    const snapshot = client.getSnapshot();

    expect(snapshot.deviceVersion).toBeGreaterThan(initialVersion);
    expect(snapshot.device?.brain.battery.batteryPercent).toBe(82);
    expect(snapshot.device?.brain.activeProgram).toBe(3);
    expect(snapshot.device?.radio.isConnected).toBe(true);
  });

  test("device disconnected events detach the device and publish an error snapshot", async () => {
    let disconnected: (() => void) | undefined;
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(true),
      on: (eventName, listener) => {
        if (eventName === "disconnected") {
          disconnected = () => {
            const onDisconnected = listener as () => void;
            onDisconnected();
          };
        }
      },
      remove: (eventName, listener) => {
        if (eventName === "disconnected" && listener !== undefined) {
          disconnected = undefined;
        }
      },
    });

    await client.connect();
    disconnected?.();
    await delay(0);
    const snapshot = client.getSnapshot();

    expect(snapshot.status).toBe("error");
    expect(snapshot.connected).toBe(false);
    expect(snapshot.error?.code).toBe("disconnect-error");
    expect(disposes).toBe(1);
    expect(disconnected).toBeUndefined();
  });

  test("device events tolerate throwing subscribers", async () => {
    let disconnected: (() => void) | undefined;
    let disposes = 0;
    let publications = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(true),
      on: (eventName, listener) => {
        if (eventName === "disconnected") {
          disconnected = () => {
            const onDisconnected = listener as () => void;
            onDisconnected();
          };
        }
      },
    });

    client.subscribe(() => {
      throw new Error("subscriber failed");
    });
    client.subscribe(() => {
      publications++;
    });

    await client.connect();
    disconnected?.();
    await delay(0);

    expect(client.getSnapshot()).toMatchObject({
      status: "error",
      connected: false,
      error: expect.objectContaining({ code: "disconnect-error" }),
    });
    expect(disposes).toBe(1);
    expect(publications).toBe(3);
  });

  test("device error events tolerate throwing subscribers", async () => {
    let deviceError: ((error: unknown) => void) | undefined;
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => okAsync(true),
      on: (eventName, listener) => {
        if (eventName === "error") {
          deviceError = (error) => {
            const onError = listener as (eventError: unknown) => void;
            onError(error);
          };
        }
      },
    });

    client.subscribe(() => {
      throw new Error("subscriber failed");
    });

    await client.connect();
    deviceError?.(new Error("device failed"));
    await delay(0);

    expect(client.getSnapshot()).toMatchObject({
      status: "error",
      connected: false,
      error: expect.objectContaining({ code: "refresh-error" }),
    });
    expect(disposes).toBe(1);
  });

  test("thrown refresh errors follow the refresh failure lifecycle", async () => {
    const refreshError = new Error("refresh threw");
    let disconnects = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {
        disconnects++;
      },
      refresh: () => {
        throw refreshError;
      },
    });

    await client.connect();
    await client.refresh();
    const snapshot = client.getSnapshot();

    expect(snapshot.status).toBe("error");
    expect(snapshot.connected).toBe(false);
    expect(snapshot.error?.code).toBe("refresh-error");
    expect(snapshot.error?.cause).toBe(refreshError);
    expect(disconnects).toBe(1);
  });

  test("connect from a refresh error creates a fresh device and restarts refresh", async () => {
    let firstDisposes = 0;
    let secondRefreshes = 0;
    const firstDevice: FakeDevice = {
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        firstDisposes++;
      },
      refresh: () => errAsync(new VexSerialError("io", "refresh failed")),
    };
    const secondDevice: FakeDevice = {
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => {
        secondRefreshes++;
        return okAsync(true);
      },
    };
    const devices = [firstDevice, secondDevice];
    let factoryCalls = 0;
    const client = createV5ClientWithFactory(
      { serial, refreshIntervalMs: 5 },
      () => {
        const device = devices[factoryCalls++];
        if (device === undefined) {
          throw new Error("unexpected device factory call");
        }
        return device;
      },
    );

    await client.connect();
    await client.refresh();
    expect(client.getSnapshot().status).toBe("error");

    const reconnected = await client.connect();

    expect(reconnected).toBe(true);
    expect(factoryCalls).toBe(2);
    expect(firstDisposes).toBe(1);
    expect(client.getSnapshot()).toMatchObject({
      status: "connected",
      connected: true,
      error: null,
    });

    await delay(20);
    expect(secondRefreshes).toBeGreaterThan(0);
    await client.disconnect();
  });

  test("refresh failure stops the timer and disconnect from error clears state", async () => {
    let refreshes = 0;
    let disposes = 0;
    const client = createClient({
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      dispose: async () => {
        disposes++;
      },
      refresh: () => {
        refreshes++;
        return errAsync(new VexSerialError("io", "refresh failed"));
      },
    });

    await client.connect();
    await client.refresh();
    await delay(20);

    expect(refreshes).toBe(1);
    expect(disposes).toBe(1);
    expect(client.getSnapshot().status).toBe("error");

    await client.disconnect();
    await client.disconnect();

    expect(disposes).toBe(1);
    expect(client.getSnapshot()).toMatchObject({
      status: "idle",
      connected: false,
      error: null,
    });
  });
});
