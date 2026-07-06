import type { Sade } from "sade";
import { withV5Device } from "../device";
import { Table } from "cmd-table";
import { FileVendor, type IFileHandle } from "@v5x/serial";

type FileRow = {
  vendor: FileVendor;
  filename: string;
  size: number;
  loadAddress: number;
  timestamp: number;
  crc32: number;
};

type ListedFile = FileRow & IFileHandle;

const VENDORS = [
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
] as const;

function vendorPrefix(vid: FileVendor): string {
  switch (vid) {
    case FileVendor.USER:
      return "user/";
    case FileVendor.SYS:
      return "sys_/";
    case FileVendor.DEV1:
      return "rmsh/";
    case FileVendor.DEV2:
      return "pros/";
    case FileVendor.DEV3:
      return "mwrk/";
    case FileVendor.DEV4:
      return "deva/";
    case FileVendor.DEV5:
      return "devb/";
    case FileVendor.DEV6:
      return "devc/";
    case FileVendor.VEXVM:
      return "vxvm/";
    case FileVendor.VEX:
      return "vex_/";
    case FileVendor.UNDEFINED:
      return "test/";
  }
}

export function formatFileTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function formatFileRows(files: FileRow[]): string[][] {
  return files.map(
    ({ vendor, filename, size, loadAddress, timestamp, crc32 }) => [
      vendorPrefix(vendor) + filename,
      formatFileSize(size),
      `0x${loadAddress.toString(16)}`,
      formatFileTimestamp(timestamp),
      `0x${crc32.toString(16)}`,
    ],
  );
}

export function toFileJson(files: FileRow[]) {
  return files.map(
    ({ vendor, filename, size, loadAddress, timestamp, crc32 }) => ({
      vendor,
      vendorPrefix: vendorPrefix(vendor).replace("/", ""),
      filename,
      path: vendorPrefix(vendor) + filename,
      size,
      loadAddress,
      timestamp,
      timestampIso: new Date(timestamp * 1000).toISOString(),
      crc32,
    }),
  );
}

export default function registerDirCommand(program: Sade) {
  program
    .command("dir", "list files on flash", { alias: "ls" })
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await withV5Device(async (device) => {
        const files: ListedFile[] = [];
        for (const vendor of VENDORS) {
          const result = await device.brain.listFiles(vendor);
          if (result.isErr()) continue;
          files.push(
            ...result.value.map((file) => ({
              ...file,
              vendor,
            })),
          );
        }
        if (options.json === true) {
          console.log(JSON.stringify(toFileJson(files), null, 2));
          return;
        }

        const table = new Table({ compact: true });
        table.addColumn("name");
        table.addColumn("size");
        table.addColumn("load address");
        table.addColumn("timestamp");
        table.addColumn("crc32");
        formatFileRows(files).forEach((row) => table.addRow(row));
        console.log(table.render());
      });
    });
}
