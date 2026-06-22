import { describe, expect, test } from "bun:test";
import { WebSerialAdapter } from "./adapter";

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

  test("reports Windows as unsupported", async () => {
    const adapter = new WebSerialAdapter("win32", async () => []);
    expect(adapter.getPorts()).rejects.toThrow("not supported");
  });
});
