import { describe, expect, test } from "bun:test";
import {
  LINUX_DISCOVERY_CONCURRENCY,
  createLinuxPortLister,
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

  test("reads USB identity from ancestors even when the tty device is not in the USB subsystem", async () => {
    const ports = await listLinuxPorts({
      readdir: async () => ["ttyACM0"],
      realpath: async () => "/sys/devices/pci/usb1/1-1/1-1:1.0/tty/ttyACM0",
      readUsbAttributes: async () => ({
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      }),
    });

    expect(ports).toEqual([
      {
        path: "/dev/ttyACM0",
        vendorId: "2888",
        productId: "0501",
        serialNumber: "vex-1",
      },
    ]);
  });

  test("leaves non-USB ttys without USB identifiers", async () => {
    const ports = await listLinuxPorts({
      readdir: async () => ["ttyS0"],
      realpath: async () => "/sys/devices/platform/serial8250",
      readUsbAttributes: async () => ({}),
    });

    expect(ports).toEqual([{ path: "/dev/ttyS0" }]);
  });

  test("keeps a tty when reading its optional USB attributes fails", async () => {
    const ports = await listLinuxPorts({
      readdir: async () => ["ttyS0"],
      realpath: async () => "/sys/devices/platform/serial8250",
      readUsbAttributes: async () => {
        throw new Error("EACCES");
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
      readUsbAttributes: async () => ({}),
    });

    expect(ports).toEqual([]);
  });

  test("caches attributes and descriptors between polls", async () => {
    let attributeReads = 0;
    const list = createLinuxPortLister({
      readdir: async () => ["ttyACM0", "ttyACM1"],
      realpath: async () => "/sys/devices/usb-1",
      readUsbAttributes: async () => {
        attributeReads++;
        return { vendorId: "2888", productId: "0501" };
      },
    });

    const first = await list();
    const second = await list();

    expect(attributeReads).toBe(1);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  test("invalidates cached identity when a tty is reattached", async () => {
    let attached = "/sys/devices/usb-old";
    let attributeReads = 0;
    const list = createLinuxPortLister({
      readdir: async () => (attached === "" ? [] : ["ttyACM0"]),
      realpath: async () => attached,
      readUsbAttributes: async (device) => {
        attributeReads++;
        return device.endsWith("old")
          ? { vendorId: "2888", productId: "0501" }
          : { vendorId: "1234", productId: "5678" };
      },
    });

    const first = await list();
    attached = "";
    await list();
    attached = "/sys/devices/usb-new";
    const second = await list();

    expect(attributeReads).toBe(2);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]).toMatchObject({ vendorId: "1234", productId: "5678" });
  });
});
