import { describe, expect, test } from "bun:test";
import {
  createWindowsPortLister,
  parseComPortNames,
  parseUsbPortAttributes,
  type WindowsDiscoveryOperations,
} from "./windows-discovery.js";

const SERIALCOMM = [
  "",
  "HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM",
  "    \\Device\\Serial0    REG_SZ    COM1",
  "    \\Device\\USBSER000    REG_SZ    COM12",
  "",
].join("\r\n");

const USB_PORT_NAMES = [
  "",
  "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2888&PID_0501\\5B00F5A4\\Device Parameters",
  "    PortName    REG_SZ    COM12",
  "",
  "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_0403&PID_6001&MI_00\\7&1e2c0e3c&0&2\\Device Parameters",
  "    PortName    REG_SZ    COM7",
  "",
].join("\r\n");

function createOperations(
  overrides: Partial<WindowsDiscoveryOperations> = {},
): WindowsDiscoveryOperations & { usbReads: number } {
  const state = {
    usbReads: 0,
    readSerialComm: async () => SERIALCOMM,
    readUsbPortNames: async () => {
      state.usbReads++;
      return USB_PORT_NAMES;
    },
    ...overrides,
  };
  return state;
}

describe("parseComPortNames", () => {
  test("reads the COM ports the device map currently lists", () => {
    expect(parseComPortNames(SERIALCOMM)).toEqual(["COM1", "COM12"]);
  });

  test("ignores values that are not COM ports", () => {
    const output = [
      "HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM",
      "    \\Device\\Serial0    REG_SZ    LPT1",
      "    \\Device\\Serial1    REG_DWORD    0x1",
    ].join("\r\n");

    expect(parseComPortNames(output)).toEqual([]);
  });

  test("survives an empty read", () => {
    expect(parseComPortNames("")).toEqual([]);
  });
});

describe("parseUsbPortAttributes", () => {
  test("takes the USB identity from the device instance path", () => {
    expect(parseUsbPortAttributes(USB_PORT_NAMES).get("COM12")).toEqual({
      vendorId: "2888",
      productId: "0501",
      serialNumber: "5B00F5A4",
    });
  });

  test("drops the interface suffix and the synthesised instance id", () => {
    expect(parseUsbPortAttributes(USB_PORT_NAMES).get("COM7")).toEqual({
      vendorId: "0403",
      productId: "6001",
    });
  });
});

describe("createWindowsPortLister", () => {
  test("reports present ports with the USB ids Web Serial filters need", async () => {
    const list = createWindowsPortLister(createOperations());

    expect(await list()).toEqual([
      { path: "COM1" },
      {
        path: "COM12",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "5B00F5A4",
      },
    ]);
  });

  test("does not rewalk the USB tree while the same ports are attached", async () => {
    const operations = createOperations();
    const list = createWindowsPortLister(operations);

    await list();
    await list();
    await list();

    expect(operations.usbReads).toBe(1);
  });

  test("rewalks the USB tree when a port that was not seen appears", async () => {
    let present = "COM1";
    const operations = createOperations({
      readSerialComm: async () =>
        `HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM\r\n    \\Device\\Serial0    REG_SZ    ${present}`,
    });
    const list = createWindowsPortLister(operations);

    await list();
    present = "COM12";
    const ports = await list();

    expect(operations.usbReads).toBe(2);
    expect(ports).toEqual([
      {
        path: "COM12",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "5B00F5A4",
      },
    ]);
  });

  test("resolves a COM name again after Windows reassigns it", async () => {
    let present = "COM12";
    const operations = createOperations({
      readSerialComm: async () =>
        `    \\Device\\USBSER000    REG_SZ    ${present}`,
    });
    const list = createWindowsPortLister(operations);

    await list();
    present = "COM1";
    await list();
    present = "COM12";
    await list();

    expect(operations.usbReads).toBe(3);
  });

  test("reports nothing when the registry cannot be read", async () => {
    const list = createWindowsPortLister({
      readSerialComm: async () => {
        throw new Error("reg is not on PATH");
      },
      readUsbPortNames: async () => {
        throw new Error("reg is not on PATH");
      },
    });

    expect(await list()).toEqual([]);
  });

  test("still lists a port whose USB identity cannot be read", async () => {
    const list = createWindowsPortLister({
      readSerialComm: async () => SERIALCOMM,
      readUsbPortNames: async () => {
        throw new Error("access denied");
      },
    });

    expect(await list()).toEqual([{ path: "COM1" }, { path: "COM12" }]);
  });
});
