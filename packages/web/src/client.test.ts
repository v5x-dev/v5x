import { describe, expect, test } from "bun:test";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { VexSerialError } from "@v5x/serial";
import {
  createV5ClientWithFactory,
  type V5ConnectionStatus,
} from "./client.js";
import { V5WebError } from "./errors.js";

interface FakeDevice {
  autoRefresh: boolean;
  connect(): ResultAsync<void, VexSerialError>;
  disconnect(): Promise<void>;
  dispose?: () => Promise<void>;
  refresh(): ResultAsync<boolean, VexSerialError>;
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
      unavailableReason: "web-serial-unavailable",
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
