import { describe, expect, test } from "bun:test";
import { createDefaultSerialBackend } from "./default-backend.js";
import { NodeSerial } from "./serial.js";
import { createWindowsSerialBackend } from "./windows-backend.js";

describe("createDefaultSerialBackend", () => {
  test("drives the Win32 communications API on Windows", () => {
    const backend = createDefaultSerialBackend("win32");

    expect(backend.name).toBe("windows-serial");
    expect(backend.platforms).toEqual(["win32"]);
  });

  test("drives bun-serialport everywhere else", () => {
    for (const platform of ["darwin", "linux"]) {
      expect(createDefaultSerialBackend(platform).name).toBe("bun-serialport");
    }
  });
});

describe("NodeSerial on Windows", () => {
  // The registry is stubbed rather than read: a hotplug poll that shelled out
  // to `reg` would keep spawning processes for the rest of the test run.
  const discovery = {
    readSerialComm: async () => "    \\Device\\USBSER000    REG_SZ    COM3",
    readUsbPortNames: async () =>
      [
        "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2888&PID_0501\\5B00F5A4\\Device Parameters",
        "    PortName    REG_SZ    COM3",
      ].join("\r\n"),
  };

  test("enumerates COM ports the Web Serial filters can match", async () => {
    const serial = new NodeSerial({
      platform: "win32",
      backend: createWindowsSerialBackend({ discovery }),
      hotplugPollInterval: 60_000,
    });

    const ports = await serial.getPorts();

    expect(ports).toHaveLength(1);
    expect(ports[0]?.getInfo()).toEqual({
      path: "COM3",
      id: "5B00F5A4",
      serialNumber: "5B00F5A4",
      usbVendorId: 0x2888,
      usbProductId: 0x0501,
    });
  });

  test("resolves a V5 brain through requestPort filters", async () => {
    const serial = new NodeSerial({
      platform: "win32",
      backend: createWindowsSerialBackend({ discovery }),
      hotplugPollInterval: 60_000,
    });

    const port = await serial.requestPort({
      filters: [{ usbVendorId: 0x2888, usbProductId: 0x0501 }],
    });

    expect(port.getInfo().path).toBe("COM3");
  });
});
