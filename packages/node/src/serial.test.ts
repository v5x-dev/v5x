import { describe, expect, test } from "bun:test";
import { createFakeBackend } from "./backend.test-support.js";
import { NodeSerial, createNodeSerial } from "./serial.js";
import { SerialConnectionEvent } from "./connection-event.js";
import type { SerialPort } from "./types.js";

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

  test("does not replace a port while its backend open is in progress", async () => {
    let serialNumber = "first";
    const backend = createFakeBackend(async () => [
      {
        path: "/dev/ttyACM0",
        vendorId: "2888",
        productId: "0501",
        serialNumber,
      },
    ]);
    let finishOpen: (() => void) | undefined;
    backend.openGate = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    const serial = new NodeSerial({ backend });
    const first = (await serial.getPorts())[0]!;

    const opening = first.open({ baudRate: 115200 });
    serialNumber = "second";
    const second = (await serial.getPorts())[0]!;

    expect(second).toBe(first);
    finishOpen?.();
    await opening;
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

  test("emits serial-level events when discovered ports change", async () => {
    let discovered = [{ path: "/dev/ttyACM0" }];
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => discovered),
      hotplugPollInterval: 1,
    });
    const events: string[] = [];
    serial.addEventListener("connect", () => events.push("connect"));
    serial.addEventListener("disconnect", () => events.push("disconnect"));

    await serial.getPorts();
    expect(events).toEqual([]);

    discovered = [{ path: "/dev/ttyACM1" }];
    await waitFor(() => events.length === 2);

    expect(events).toEqual(["disconnect", "connect"]);
    expect(
      (await serial.getPorts()).map((port) => port.getInfo().path),
    ).toEqual(["/dev/ttyACM1"]);
  });

  test("reports a physical removal once on the port and once on the serial", async () => {
    let discovered = [{ path: "/dev/ttyACM0" }];
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => discovered),
      hotplugPollInterval: 1,
    });
    const removed = (await serial.getPorts())[0]!;
    let portDisconnects = 0;
    removed.addEventListener("disconnect", () => {
      portDisconnects++;
    });
    const serialDisconnects: (SerialPort | undefined)[] = [];
    serial.addEventListener("disconnect", (event) => {
      serialDisconnects.push((event as SerialConnectionEvent).port);
    });

    discovered = [];
    await waitFor(() => serialDisconnects.length === 1);
    // Several more polls see the same absence and must not re-report it.
    await Bun.sleep(25);

    expect(portDisconnects).toBe(1);
    expect(serialDisconnects).toEqual([removed]);
  });

  test("an explicit close of a still-present port reports no removal", async () => {
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => [{ path: "/dev/ttyACM0" }]),
      hotplugPollInterval: 1,
    });
    const port = (await serial.getPorts())[0]!;
    let disconnects = 0;
    port.addEventListener("disconnect", () => {
      disconnects++;
    });
    serial.addEventListener("disconnect", () => {
      disconnects++;
    });

    await port.open({ baudRate: 115200 });
    await port.close();
    await port.forget();
    await Bun.sleep(25);

    expect(disconnects).toBe(0);
  });

  test("continues hotplug checks after a discovery failure", async () => {
    let calls = 0;
    const serial = new NodeSerial({
      backend: createFakeBackend(async () => {
        calls++;
        if (calls === 2) throw new Error("temporary list failure");
        return calls < 4 ? [] : [{ path: "/dev/ttyACM0" }];
      }),
      hotplugPollInterval: 1,
    });
    let connects = 0;
    serial.addEventListener("connect", () => {
      connects++;
    });

    await serial.getPorts();
    await waitFor(() => connects === 1);

    expect(calls).toBeGreaterThanOrEqual(4);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for event");
    await Bun.sleep(1);
  }
}
