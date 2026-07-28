import { describe, expect, test } from "bun:test";
import {
  LINUX_DISCOVERY_CONCURRENCY,
  listLinuxPorts,
  readLinuxUsbDeviceAttributes,
} from "./linux-discovery.js";

function readerFor(files: Map<string, string>) {
  return async (path: string): Promise<string> => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`missing ${path}`);
    return value;
  };
}

describe("Linux discovery", () => {
  test("reads USB vendor, product, and serial attributes", async () => {
    const files = new Map([
      ["/sys/devices/pci/idVendor", "2888\n"],
      ["/sys/devices/pci/idProduct", "0501\n"],
      ["/sys/devices/pci/serial", "vex-123\n"],
    ]);

    expect(
      await readLinuxUsbDeviceAttributes(
        "/sys/devices/pci/tty",
        readerFor(files),
      ),
    ).toEqual({
      vendorId: "2888",
      productId: "0501",
      serialNumber: "vex-123",
    });
  });

  test("keeps the USB serial unknown when the attribute is absent", async () => {
    const files = new Map([
      ["/sys/devices/pci/tty/idVendor", "2888\n"],
      ["/sys/devices/pci/tty/idProduct", "0501\n"],
    ]);

    expect(
      await readLinuxUsbDeviceAttributes(
        "/sys/devices/pci/tty",
        readerFor(files),
      ),
    ).toEqual({
      vendorId: "2888",
      productId: "0501",
      serialNumber: undefined,
    });
  });

  test("returns no attributes when no USB device node is found", async () => {
    expect(
      await readLinuxUsbDeviceAttributes(
        "/sys/devices/platform/tty",
        async () => Promise.reject(new Error("ENOENT")),
      ),
    ).toEqual({});
  });

  test("discovers a large TTY set with bounded concurrency and stable ordering", async () => {
    const names = Array.from(
      { length: 100 },
      (_, index) => `ttyACM${String(99 - index).padStart(3, "0")}`,
    );
    names.push("denied");
    let active = 0;
    let maximumActive = 0;
    let attributeReads = 0;

    const ports = await listLinuxPorts({
      readdir: async () => names,
      realpath: async (path) => {
        if (path.endsWith("/denied/device")) throw new Error("EACCES");
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(1);
        active--;
        const index = Number(path.match(/ttyACM(\d+)/)?.[1] ?? 0);
        return `/sys/devices/usb-${index % 10}`;
      },
      readlink: async () => "/sys/bus/usb",
      readUsbAttributes: async () => {
        attributeReads++;
        await Bun.sleep(1);
        return { vendorId: "2888", productId: "0501" };
      },
    });

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(LINUX_DISCOVERY_CONCURRENCY);
    expect(attributeReads).toBe(10);
    expect(ports.map((port) => port.path)).toEqual(
      names
        .filter((name) => name !== "denied")
        .toSorted()
        .map((name) => `/dev/${name}`),
    );
  });

  test("leaves non-USB ttys without USB identifiers", async () => {
    const ports = await listLinuxPorts({
      readdir: async () => ["ttyS0"],
      realpath: async () => "/sys/devices/platform/serial8250",
      readlink: async () => "/sys/bus/platform",
      readUsbAttributes: async () => {
        throw new Error("should not read USB attributes for a platform tty");
      },
    });

    expect(ports).toEqual([{ path: "/dev/ttyS0" }]);
  });

  test("reports no ports when sysfs is unreadable", async () => {
    const ports = await listLinuxPorts({
      readdir: async () => {
        throw new Error("ENOENT");
      },
      realpath: async () => "",
      readlink: async () => "",
      readUsbAttributes: async () => ({}),
    });

    expect(ports).toEqual([]);
  });
});
