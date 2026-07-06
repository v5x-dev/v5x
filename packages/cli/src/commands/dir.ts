import type { Sade } from "sade";
import type { FileVendor, IFileHandle } from "@v5x/serial";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { VENDOR_PREFIXES, VENDORS } from "../utils/brainPath";
import { printJson, renderTable, utcTimestamp } from "../utils/output";

type FileRow = {
  vendor: FileVendor;
  filename: string;
  size: number;
  loadAddress: number;
  timestamp: number;
  crc32: number;
};

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
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(async (options: { json?: boolean } & PortSelectionOptions) => {
      await withSelectedV5Device(options, async (device) => {
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
