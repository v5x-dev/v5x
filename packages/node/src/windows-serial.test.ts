import { describe, expect, test } from "bun:test";
import type { NativePort } from "./backend.js";
import { FakeKernel32 } from "./windows-serial.test-support.js";
import {
  openWindowsSerialPort,
  toWindowsDevicePath,
} from "./windows-serial.js";

const READ_INTERVAL = 1;

async function openFakePort(
  kernel32: FakeKernel32,
  path = "COM3",
): Promise<NativePort> {
  return openWindowsSerialPort({
    path,
    baudRate: 115200,
    kernel32,
    readInterval: READ_INTERVAL,
  });
}

function nextData(port: NativePort): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const listener = (chunk: Uint8Array) => {
      port.off("data", listener);
      resolve(chunk);
    };
    port.on("data", listener);
  });
}

describe("toWindowsDevicePath", () => {
  test("routes COM ports through the device namespace", () => {
    // COM10 and above do not resolve as bare DOS names.
    expect(toWindowsDevicePath("COM10")).toBe("\\\\.\\COM10");
    expect(toWindowsDevicePath("com3")).toBe("\\\\.\\COM3");
  });

  test("leaves a path that is already explicit alone", () => {
    expect(toWindowsDevicePath("\\\\.\\COM3")).toBe("\\\\.\\COM3");
  });
});

describe("openWindowsSerialPort", () => {
  test("opens the device namespace path", async () => {
    const kernel32 = new FakeKernel32();

    const port = await openFakePort(kernel32, "COM12");
    await port.close();

    expect(kernel32.path).toBe("\\\\.\\COM12");
  });

  test("configures the port for raw 8-N-1 at the requested baud rate", async () => {
    const kernel32 = new FakeKernel32();

    const port = await openFakePort(kernel32);
    await port.close();

    const dcb = kernel32.dcb!;
    expect(dcb.getUint32(0, true)).toBe(28);
    expect(dcb.getUint32(4, true)).toBe(115200);
    expect(dcb.getUint8(18)).toBe(8);
    expect(dcb.getUint8(19)).toBe(0);
    expect(dcb.getUint8(20)).toBe(0);

    // fBinary, plus DTR and RTS enabled so a USB CDC device opens its pipe.
    const flags = dcb.getUint32(8, true);
    expect(flags & 0b1).toBe(1);
    expect((flags >> 4) & 0b11).toBe(1);
    expect((flags >> 12) & 0b11).toBe(1);
  });

  test("makes reads return immediately instead of blocking", async () => {
    const kernel32 = new FakeKernel32();

    const port = await openFakePort(kernel32);
    await port.close();

    const timeouts = kernel32.timeouts!;
    expect(timeouts.getUint32(0, true)).toBe(0xffff_ffff);
    expect(timeouts.getUint32(4, true)).toBe(0);
    expect(timeouts.getUint32(8, true)).toBe(0);
  });

  test("closes the handle when configuration fails", async () => {
    const kernel32 = new FakeKernel32({ fail: "SetCommState" });

    await expect(openFakePort(kernel32)).rejects.toThrow("SetCommState");
    expect(kernel32.openHandles).toBe(0);
  });

  test("reports why the port could not be opened", async () => {
    const kernel32 = new FakeKernel32({ fail: "CreateFileW", lastError: 5 });

    await expect(openFakePort(kernel32)).rejects.toThrow(
      "open COM3: fake failure 5",
    );
  });
});

describe("WindowsSerialPort", () => {
  test("emits the bytes a poll read", async () => {
    const kernel32 = new FakeKernel32();
    const port = await openFakePort(kernel32);
    kernel32.incoming.push(new Uint8Array([1, 2, 3]));

    expect(await nextData(port)).toEqual(new Uint8Array([1, 2, 3]));
    await port.close();
  });

  test("emits nothing while the device is quiet", async () => {
    const kernel32 = new FakeKernel32();
    const port = await openFakePort(kernel32);
    const chunks: Uint8Array[] = [];
    port.on("data", (chunk) => chunks.push(chunk));

    await Bun.sleep(10);
    await port.close();

    expect(chunks).toEqual([]);
    expect(
      kernel32.calls.filter((call) => call === "ReadFile").length,
    ).toBeGreaterThan(0);
  });

  test("stops polling once a read fails and reports the failure once", async () => {
    const kernel32 = new FakeKernel32({ fail: "ReadFile", lastError: 22 });
    const port = await openFakePort(kernel32);
    const errors: Error[] = [];
    port.on("error", (error) => errors.push(error));

    await Bun.sleep(10);
    await port.close();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("read: fake failure 22");
  });

  test("writes every byte when the driver accepts them in pieces", async () => {
    const kernel32 = new FakeKernel32();
    kernel32.writeChunkSize = 2;
    const port = await openFakePort(kernel32);

    await port.write(new Uint8Array([1, 2, 3, 4, 5]));
    await port.close();

    expect(kernel32.written).toEqual([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5]),
    ]);
  });

  test("refuses to write to a closed port", async () => {
    const kernel32 = new FakeKernel32();
    const port = await openFakePort(kernel32);
    await port.close();

    await expect(port.write(new Uint8Array([1]))).rejects.toThrow(
      "Port is not open",
    );
  });

  test("suspends the read poll while paused", async () => {
    const kernel32 = new FakeKernel32();
    const port = await openFakePort(kernel32);

    port.pause?.();
    const paused = kernel32.calls.filter((call) => call === "ReadFile").length;
    await Bun.sleep(10);
    expect(kernel32.calls.filter((call) => call === "ReadFile").length).toBe(
      paused,
    );

    port.resume?.();
    await Bun.sleep(10);
    expect(
      kernel32.calls.filter((call) => call === "ReadFile").length,
    ).toBeGreaterThan(paused);
    await port.close();
  });

  test("releases the handle on close and tolerates a second close", async () => {
    const kernel32 = new FakeKernel32();
    const port = await openFakePort(kernel32);

    await port.close();
    await port.close();

    expect(kernel32.openHandles).toBe(0);
    expect(kernel32.calls.filter((call) => call === "CloseHandle")).toEqual([
      "CloseHandle",
    ]);
  });
});
