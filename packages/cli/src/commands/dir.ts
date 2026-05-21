import { defineCommand } from "@bunli/core";
import { getV5Device } from "../plugins/device";
import { FileVendor, IFileHandle } from "@v5x/serial";
import Table from "cli-table";

const J2000_EPOCH = 946684800;

const USEFUL_VENDORS = [
  FileVendor.USER,
  FileVendor.SYS,
  FileVendor.DEV1,
  FileVendor.DEV2,
  FileVendor.DEV3,
  FileVendor.DEV4,
  FileVendor.DEV5,
  FileVendor.DEV6,
  FileVendor.VEXVM,
  FileVendor.VEX,
  FileVendor.UNDEFINED,
] as const satisfies readonly FileVendor[];

export const VENDOR_PREFIXES = {
  [FileVendor.USER]: "user",
  [FileVendor.SYS]: "sys_",
  [FileVendor.DEV1]: "rmsh",
  [FileVendor.DEV2]: "pros",
  [FileVendor.DEV3]: "mwrk",
  [FileVendor.DEV4]: "deva",
  [FileVendor.DEV5]: "devb",
  [FileVendor.DEV6]: "devc",
  [FileVendor.VEXVM]: "vxvm",
  [FileVendor.VEX]: "vex_",
  [FileVendor.UNDEFINED]: "test",
} as const;

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];

  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 2 : 0)} ${units[unit]}`;
}

const dirCommand = defineCommand({
  name: "dir",
  description: "list files on flash",
  alias: "ls",
  handler: async ({ context, colors }) => {
    if (!context) return;
    const device = getV5Device(context);
    if (!device) return;

    const table = new Table({
      head: ["name", "size", "load address", "vendor", "timestamp", "crc32"],
      style: {
        head: ["bold"],
        "padding-left": 0,
        "padding-right": 0,
      },
      chars: {
        top: "",
        "top-mid": "",
        "top-left": "",
        "top-right": "",
        bottom: "",
        "bottom-mid": "",
        "bottom-left": "",
        "bottom-right": "",
        left: "",
        "left-mid": "",
        mid: "",
        "mid-mid": "",
        right: "",
        "right-mid": "",
        middle: "  ",
      },
    });

    for (const vendor of USEFUL_VENDORS) {
      const vendorFiles = await device.brain.listFiles(vendor);
      if (!vendorFiles) continue;

      table.push(
        ...vendorFiles.map((f) => {
          const timestamp = new Date(f.timestamp * 1000);

          return [
            `${VENDOR_PREFIXES[f.vendor]}/${f.filename}`,
            formatSize(f.size),
            `0x${f.loadAddress.toString(16)}`,
            VENDOR_PREFIXES[vendor].replace("_", ""),
            f.vendor === FileVendor.VEX || f.vendor === FileVendor.SYS
              ? "-"
              : timestamp
                  .toISOString()
                  .replace("T", " ")
                  .replace(/\.\d+Z$/, ""),
            `0x${f.crc32.toString(16)}`,
          ];
        }),
      );
    }

    console.log(table.toString());
  },
});

export default dirCommand;
