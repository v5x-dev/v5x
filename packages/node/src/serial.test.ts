import { describe, expect, test } from "bun:test";
import { createFakeBackend } from "./backend.test-support.js";
import { NodeSerial, createNodeSerial } from "./serial.js";

describe("NodeSerial", () => {
  test("reuses port objects so open state is shared", async () => {
    const serial = createNodeSerial({
      backend: createFakeBackend(async () => [
        { path: "/dev/ttyACM0", vendorId: "2888", productId: "0501" },
      ]),
    });

    const first = await serial.getPorts();
    const second = await serial.getPorts();

    expect(second[0]).toBe(first[0]);
    expect(first[0]?.getInfo()).toEqual({
      path: "/dev/ttyACM0",
      id: "/dev/ttyACM0",
      usbVendorId: 10376,
      usbProductId: 1281,
    });
  });

  test("replaces a closed port when its discovered USB identity changes", async () => {
    let discovered = {
      path: "/dev/ttyACM0",
      vendorId: "2888",
      productId: "0501",
      serialNumber: "first",
    };
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => [discovered]),
    });

    const first = (await serial.getPorts())[0]!;
    discovered = {
      path: "/dev/ttyACM0",
      vendorId: "1234",
      productId: "5678",
      serialNumber: "second",
    };
    const second = (await serial.getPorts())[0]!;

    expect(second).not.toBe(first);
    expect(second.getInfo()).toEqual({
      path: "/dev/ttyACM0",
      id: "second",
      serialNumber: "second",
      usbVendorId: 0x1234,
      usbProductId: 0x5678,
    });
    await expect(
      serial.requestPort({
        filters: [{ usbVendorId: 0x1234, usbProductId: 0x5678 }],
      }),
    ).resolves.toBe(second);
  });

  test("does not replace an open port when discovery reports a new identity", async () => {
    let serialNumber = "first";
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => [
        {
          path: "/dev/ttyACM0",
          vendorId: "2888",
          productId: "0501",
          serialNumber,
        },
      ]),
    });
    const first = (await serial.getPorts())[0]!;
    await first.open({ baudRate: 115200 });

    serialNumber = "second";
    const second = (await serial.getPorts())[0]!;

    expect(second).toBe(first);
    expect(second.getInfo().serialNumber).toBe("first");
    await first.close();
  });

  test("keeps USB identifiers unknown when the platform omits them", async () => {
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => [{ path: "/dev/cu.usbmodem01" }]),
    });

    const ports = await serial.getPorts();

    expect(ports[0]?.getInfo()).toEqual({
      path: "/dev/cu.usbmodem01",
      id: "/dev/cu.usbmodem01",
      usbVendorId: undefined,
      usbProductId: undefined,
    });
    await expect(
      serial.requestPort({ filters: [{ usbVendorId: 10376 }] }),
    ).rejects.toThrow("No port found matching filters");
  });

  test("refuses to enumerate on a platform the backend does not support", async () => {
    const serial = new NodeSerial({
      platform: "win32",
      backend: createFakeBackend(async () => [], ["darwin", "linux"]),
    });

    await expect(serial.getPorts()).rejects.toThrow(
      "The fake backend does not support win32",
    );
  });

  test("enumerates on any platform when the backend declares no restriction", async () => {
    const serial = new NodeSerial({
      platform: "win32",
      backend: createFakeBackend(async () => [{ path: "COM3" }]),
    });

    expect(
      (await serial.getPorts()).map((port) => port.getInfo().path),
    ).toEqual(["COM3"]);
  });

  test("honors serial-level event-handler properties", () => {
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => []),
    });
    let propertyCalls = 0;
    let listenerCalls = 0;
    serial.onconnect = () => {
      propertyCalls++;
    };
    serial.addEventListener("connect", () => {
      listenerCalls++;
    });

    serial.dispatchEvent(new Event("connect"));
    serial.onconnect = null;
    serial.dispatchEvent(new Event("connect"));

    expect(propertyCalls).toBe(1);
    expect(listenerCalls).toBe(2);
  });
});
