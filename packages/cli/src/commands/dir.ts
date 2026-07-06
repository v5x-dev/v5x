import type { Sade } from "sade";
import { FileVendor, type IFileHandle } from "@v5x/serial";
import { withV5Device } from "../device";
import { printJson, renderTable, utcTimestamp } from "../utils/output";

type FileRow = {
  vendor: FileVendor;
  filename: string;
  size: number;
  loadAddress: number;
  timestamp: number;
  crc32: number;
};

const VENDOR_PREFIXES: Record<FileVendor, string> = {
  [FileVendor.USER]: "user/",
  [FileVendor.SYS]: "sys_/",
  [FileVendor.DEV1]: "rmsh/",
  [FileVendor.DEV2]: "pros/",
  [FileVendor.DEV3]: "mwrk/",
  [FileVendor.DEV4]: "deva/",
  [FileVendor.DEV5]: "devb/",
  [FileVendor.DEV6]: "devc/",
  [FileVendor.VEXVM]: "vxvm/",
  [FileVendor.VEX]: "vex_/",
  [FileVendor.UNDEFINED]: "test/",
};

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

export function formatFileTimestamp(timestamp: number): string {
  return utcTimestamp.format(new Date(timestamp * 1000));
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
      VENDOR_PREFIXES[vendor] + filename,
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
      vendorPrefix: VENDOR_PREFIXES[vendor].replace("/", ""),
      filename,
      path: VENDOR_PREFIXES[vendor] + filename,
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
        const files: (FileRow & IFileHandle)[] = [];
        for (const vendor of VENDORS) {
          const result = await device.brain.listFiles(vendor);
          if (result.isOk())
            files.push(...result.value.map((file) => ({ ...file, vendor })));
        }
        if (options.json === true) printJson(toFileJson(files));
        else
          console.log(
            renderTable(
              ["name", "size", "load address", "timestamp", "crc32"],
              formatFileRows(files),
            ),
          );
      });
    });
}
