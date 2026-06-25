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
});
