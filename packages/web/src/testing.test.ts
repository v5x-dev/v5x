import { describe, expect, test } from "bun:test";
import { okAsync } from "neverthrow";
import { createV5ClientWithFactory, type V5DeviceLike } from "./testing.js";

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

describe("@v5x/web/testing", () => {
  test("exports the factory client hook for fake devices", async () => {
    const device: V5DeviceLike = {
      autoRefresh: true,
      connect: () => okAsync(undefined),
      disconnect: async () => {},
      refresh: () => okAsync(true),
    };

    const client = createV5ClientWithFactory(
      { serial: new FakeSerial() },
      () => device,
    );

    expect(await client.connect()).toBe(true);
    expect(client.getSnapshot().connected).toBe(true);
  });
});
